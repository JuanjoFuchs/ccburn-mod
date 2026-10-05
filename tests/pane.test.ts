import { describe, expect, mock, test } from 'claude-code/testing'

import { INLINE_ROWS, MESSAGES } from '../hooks/views/pane'
import { command, limits, measure, NOW, pane, PLUGIN, SESSION, worldOf } from './fixtures/world'

const SURFACES = ['terminal', 'desktop'] as const
const MINUTE = 60_000

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string | null | undefined

/** Terminal rows a drawn tree takes: a Text, Button or Box row is one; a Raster its rows; a Box its height. */
function rowsOf(tree: unknown): number {
  const node = tree as Node
  if (node === null || node === undefined || typeof node === 'string') return 0
  if (node.type === 'Raster') return Number(node.props?.rows ?? 0)
  if (node.type === 'Box' && typeof node.props?.height === 'number') return node.props.height
  if (node.type !== 'Box') return 1
  const kids = (node.children ?? []).map(rowsOf)
  return node.props?.flexDirection === 'column' ? kids.reduce((a, b) => a + b, 0) : Math.max(0, ...kids)
}

describe('the pane', () => {
  for (const surface of SURFACES) {
    test(`fills the body on ${surface}: header, gauges, chart where there is a Raster, toggle`, async ($, on) => {
      const world = worldOf(on)
      world.rateLimits = limits(40)
      mock.clock(on, { now: NOW })
      await $.session.start({ ...SESSION, surface })

      for (const [columns, rows] of [[80, 30], [160, 40]] as const) {
        const mounted = await $.ui.mount(pane(surface, columns, rows))
        const raster = await mounted.find({ type: 'Raster' })

        if (surface === 'terminal') {
          expect(raster?.props.columns).toBe(columns)
          expect(raster?.props.rows).toBe(rows - 4)
        } else {
          expect(raster).toBeUndefined()
        }

        expect(await mounted.find({ type: 'Text', text: 'ccburn' })).toBeDefined()
        expect(await mounted.find({ type: 'Text', text: '40%' })).toBeDefined()
        expect((await mounted.find({ type: 'Button', key: 'window' }))?.props.label).toBe('Show Weekly')
        await mounted.unmount()
      }
    })
  }

  test('a body under 40 × 15 shows the too-small line and no chart', async ($, on) => {
    const world = worldOf(on)
    world.rateLimits = limits(40)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)

    for (const [columns, rows] of [[39, 30], [80, 14]] as const) {
      const mounted = await $.ui.mount(pane('terminal', columns, rows))
      expect(await mounted.find({ type: 'Raster' })).toBeUndefined()
      expect(await mounted.find({ text: MESSAGES.tooSmall })).toBeDefined()
      await mounted.unmount()
    }
  })

  test('inline above the prompt it draws tall enough to be given room, and fits the room it gets', async ($, on) => {
    const world = worldOf(on)
    world.rateLimits = limits(40)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)

    // Given only the rows its last, shorter content needed: it pads itself to INLINE_ROWS.
    const short = await $.ui.mount(pane('terminal', 98, 5, 'inline'))
    expect(await short.find({ type: 'Raster' })).toBeUndefined()
    expect(rowsOf(await short.drawn())).toBeGreaterThanOrEqual(INLINE_ROWS)
    await short.unmount()

    // Given 12 rows: the chart takes the 8 left after the header, gauges and toggle.
    const room = await $.ui.mount(pane('terminal', 98, 12, 'inline'))
    expect((await room.find({ type: 'Raster' }))?.props.rows).toBe(8)
    await room.unmount()
  })

  test('before any reading it waits; an account with no windows says so', async ($, on) => {
    worldOf(on)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)

    const mounted = await $.ui.mount(pane('terminal', 80, 30))
    expect(await mounted.find({ text: MESSAGES.waiting })).toBeDefined()
    expect(await mounted.find({ text: '⏳ Loading...' })).toBeDefined()

    await $.session.measure(measure([]))
    expect(await mounted.find({ text: MESSAGES.withoutLimits })).toBeDefined()
    await mounted.unmount()
  })

  test('a reading draws the chart, and a minute later Now and the countdown move', async ($, on) => {
    worldOf(on)
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)

    const mounted = await $.ui.mount(pane('terminal', 80, 30))
    expect(await mounted.find({ type: 'Raster' })).toBeUndefined()

    await $.session.measure(measure(limits(40)))
    const before = await mounted.find({ type: 'Raster' })
    expect(before).toBeDefined()
    expect((await mounted.find({ text: /^Resets in / }))?.text).toBe('Resets in 2h 30m')

    await clock.advance(MINUTE)
    expect((await mounted.find({ text: /^Resets in / }))?.text).toBe('Resets in 2h 29m')
    const after = await mounted.find({ type: 'Raster' })
    expect(after?.props.cells).not.toBe(before?.props.cells)
    await mounted.unmount()
  })
})

describe('the /ccburn command', () => {
  test('opens the 5-hour chart, `weekly` the weekly one, and the button toggles', async ($, on) => {
    const world = worldOf(on)
    world.rateLimits = limits(40, 25)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    world.opened.length = 0

    const opened = await $.command.run(command())
    expect(opened.text).toBe('Session (5h) chart open.')
    expect(world.opened).toEqual(['ccburn'])
    // Inline above the prompt the pane is only as tall as it asks: enough for the chart.
    expect(world.openedRows[0]).toBeGreaterThanOrEqual(15)

    const mounted = await $.ui.mount(pane('terminal', 80, 30))
    expect(await mounted.find({ text: 'Session (5h)' })).toBeDefined()

    await $.command.run(command('weekly'))
    expect(await mounted.find({ text: 'Weekly' })).toBeDefined()
    expect((await mounted.find({ type: 'Button', key: 'window' }))?.props.label).toBe('Show Session (5h)')

    await mounted.press({ key: 'window', plugin: PLUGIN })
    expect(await mounted.find({ text: 'Session (5h)' })).toBeDefined()

    expect((await $.command.run(command('monthly'))).text).toBe('Usage: /ccburn [weekly]')
    await mounted.unmount()
  })

  test('the command is registered at session start', async ($, on) => {
    const world = worldOf(on)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    expect(world.commands).toEqual(['ccburn'])
  })
})

describe('openOnStart', () => {
  test('opens the pane at session start by default', async ($, on) => {
    const world = worldOf(on)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    expect(world.opened).toEqual(['ccburn'])
  })

  test('leaves it closed when turned off', { options: { openOnStart: false } }, async ($, on) => {
    const world = worldOf(on)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    expect(world.opened).toEqual([])
  })
})

describe('history', () => {
  test('a reading is stored, merged with another session’s, and survives a fresh start', async ($, on) => {
    const other = { provider: 'claude-code', kind: 'five_hour', timestamp: NOW - 10 * MINUTE, percentUsed: 35, resetsAt: Date.parse('2026-09-15T19:00:00Z') }
    const stale = { ...other, timestamp: NOW - 6 * 60 * MINUTE, resetsAt: NOW - 60 * MINUTE }
    const world = worldOf(on, { readings: [stale, other] })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)

    await $.session.measure(measure(limits(40)))
    await clock.settle()

    const stored = world.store.get('readings') as { timestamp: number; percentUsed: number; kind: string }[]
    const fiveHour = stored.filter(r => r.kind === 'five_hour')
    expect(fiveHour.map(r => [r.timestamp, r.percentUsed])).toEqual([
      [NOW - 10 * MINUTE, 35],
      [NOW, 40],
    ])
    expect(stored.some(r => r.kind === 'seven_day')).toBe(true)
  })
})
