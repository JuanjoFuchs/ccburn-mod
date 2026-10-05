import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Reading, WindowKind } from '../types'
import { machineOffset } from './core/clock'
import { collectStdin, COLLECT_ARGV, HISTORY_ARGV, parseHistory } from './core/ccburn'
import { DISPLAY_NAME } from './core/gauges'
import { fromStore, limitOf, merge, readingsOf, snapshotsOf } from './core/readings'
import { drawPane, INLINE_ROWS } from './views/pane'

const PANE = 'ccburn'
const TITLE = 'ccburn'
const STORE_KEY = 'readings'
const TICK_MS = 60_000
const CCBURN_TIMEOUT_MS = 10_000
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

/**
 * Spec 002: share history with ccburn while it answers. Set from `useCcburn`
 * at session start; a failed call turns it off until the next session.
 */
let isCcburnUp = true

/** Pulls ccburn's history (every session's readings) into what the pane draws. */
async function readCcburn($: Engine): Promise<void> {
  if (!isCcburnUp) {
    return
  }

  const result = await $.process.run(HISTORY_ARGV, { timeoutMs: CCBURN_TIMEOUT_MS })
  const shared = result.exitCode === 0 ? parseHistory(result.stdout) : null

  if (shared === null) {
    isCcburnUp = false
    return
  }

  const now = await $.clock.now()
  await update($, readingsAtom, current => merge(current, shared, now))
}

/** Hands this session's readings to ccburn's history, as the status line would. */
async function writeCcburn($: Engine, fresh: readonly Reading[]): Promise<void> {
  if (!isCcburnUp) {
    return
  }

  const result = await $.process.run(COLLECT_ARGV, { stdin: collectStdin(fresh), timeoutMs: CCBURN_TIMEOUT_MS })
  if (result.exitCode !== 0) {
    isCcburnUp = false
  }
}

/** The minute tick: ccburn's history first, then the clock the chart is drawn against. */
async function tick($: Engine): Promise<void> {
  try {
    await readCcburn($)
  } catch {
    isCcburnUp = false
  }

  const at = await $.clock.now()
  await update($, nowAtom, () => at)
}

/** After a measured reading: this plugin's store, then ccburn's history. */
async function persist($: Engine, fresh: readonly Reading[]): Promise<void> {
  await save($, fresh)

  try {
    await writeCcburn($, fresh)
  } catch {
    isCcburnUp = false
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    isCcburnUp = options.useCcburn !== false

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

    // The first read of ccburn runs at once, off this hook; then every minute with the clock.
    $.clock.after(0, () => {
      void tick($).catch(() => undefined)
    })
    $.clock.every(TICK_MS, () => {
      void tick($).catch(() => undefined)
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
        void persist($, fresh).catch(() => undefined)
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
