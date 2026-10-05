import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Reading, WindowKind } from '../types'
import { machineOffset } from './core/clock'
import { DISPLAY_NAME } from './core/gauges'
import { fromStore, limitOf, merge, readingsOf, snapshotsOf } from './core/readings'
import { drawPane, INLINE_ROWS } from './views/pane'

const PANE = 'ccburn'
const TITLE = 'ccburn'
const STORE_KEY = 'readings'
const TICK_MS = 60_000
/**
 * Body rows to ask for when the pane sits inline above the prompt (a terminal
 * that is not fullscreen): the header, gauges, chart and toggle row. A docked
 * pane ignores it and runs floor to ceiling.
 */
const OPEN = { id: PANE, title: TITLE, rows: INLINE_ROWS } as const

const windowAtom = atom({ plugin: 'ccburn', key: 'window' } as const, 'five_hour' as WindowKind)
const readingsAtom = atom({ plugin: 'ccburn', key: 'readings' } as const, [] as Reading[])
const nowAtom = atom({ plugin: 'ccburn', key: 'now' } as const, 0)
const withoutLimitsAtom = atom({ plugin: 'ccburn', key: 'isWithoutLimits' } as const, false)

/** `weekly` (or `week`, `7d`) picks the weekly window; nothing or `session` the 5-hour one. */
function windowOfArgs(args: string): WindowKind | null {
  const arg = args.trim().toLowerCase()

  if (arg === '' || arg === 'session' || arg === '5h') {
    return 'five_hour'
  }

  return arg === 'weekly' || arg === 'week' || arg === '7d' ? 'seven_day' : null
}

/** Merges new readings into the shared store, then pulls in what other sessions wrote. */
async function save($: Engine, fresh: readonly Reading[]): Promise<void> {
  const now = await $.clock.now()
  const stored = fromStore(await $.store.get(STORE_KEY))
  const merged = merge(stored, fresh, now)
  await $.store.set(STORE_KEY, merged)
  await update($, readingsAtom, current => merge(current, merged, now))
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ccburn',
      description: "Show ccburn's burn-up chart for your rate limits (add 'weekly' for the 7-day window)",
      argumentHint: '[weekly]',
    })

    const now = await $.clock.now()
    const stored = fromStore(await $.store.get(STORE_KEY))
    const usage = await $.session.usage()
    const fresh = readingsOf(usage.rateLimits, now)
    await update($, readingsAtom, () => merge(stored, fresh, now))
    await update($, nowAtom, () => now)

    if (fresh.length > 0) {
      void save($, fresh).catch(() => undefined)
    }

    $.clock.every(TICK_MS, () => {
      void $.clock
        .now()
        .then(at => update($, nowAtom, () => at))
        .catch(() => undefined)
    })

    if (options.openOnStart !== false) {
      void $.ui.open(OPEN).catch(() => undefined)
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    const fresh = readingsOf(e.rateLimits, now)

    if (fresh.length > 0) {
      await update($, withoutLimitsAtom, () => false)
      await update($, readingsAtom, current => merge(current, fresh, now))
      // The store write runs on a timer so this hook never waits on it.
      $.clock.after(0, () => {
        void save($, fresh).catch(() => undefined)
      })
    } else if (e.rateLimits.length === 0) {
      await update($, withoutLimitsAtom, () => true)
    }

    await update($, nowAtom, () => now)

    return next(e)
  })

  on('command.run', { command: 'ccburn' }, async ($, e) => {
    const kind = windowOfArgs(e.args)

    if (kind === null) {
      return { text: 'Usage: /ccburn [weekly]' }
    }

    await update($, windowAtom, () => kind)
    const opened = await $.ui.open(OPEN)

    // The engine already prefixes a command's output with the plugin's name.
    return {
      text: opened.isPlaced ? `${DISPLAY_NAME[kind]} chart open.` : `The pane is waiting for room (${opened.reason}).`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kind = await read($, windowAtom)
    const readings = await read($, readingsAtom)
    const isWithoutLimits = await read($, withoutLimitsAtom)
    await read($, nowAtom)
    const now = await $.clock.now()

    return drawPane($.ui.resolve(e), {
      kind,
      limit: limitOf(readings, kind),
      snapshots: snapshotsOf(readings, kind),
      isWithoutLimits,
      now,
      columns: Math.floor(e.props.bodyColumns),
      rows: Math.floor(e.props.scroll.bodyRows),
      placement: e.props.placement,
      offsetAt: machineOffset,
      onToggle: () => {
        void update($, windowAtom, current => (current === 'five_hour' ? 'seven_day' : 'five_hour'))
      },
    })
  })
}
