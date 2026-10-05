import { describe, expect, mock, test } from 'claude-code/testing'

import { collectStdin, parseHistory } from '../hooks/core/ccburn'
import { ccburnHistoryOf, limits, measure, NOW, pane, RESETS, SESSION, worldOf } from './fixtures/world'

const MINUTE = 60_000

describe('ccburn contracts (unit)', () => {
  test('history parses into readings; malformed snapshots and limits are skipped', () => {
    const out = parseHistory(
      JSON.stringify({
        version: 1,
        data_dir: '/x',
        snapshots: [
          { timestamp: '2026-09-15T16:00:00+00:00', limits: { five_hour: { used_percentage: 6, resets_at: '2026-09-15T19:00:00+00:00' } } },
          { timestamp: 'not a time', limits: {} },
          { timestamp: '2026-09-15T16:10:00+00:00', limits: { five_hour: { used_percentage: 'x' }, seven_day: { used_percentage: 7, resets_at: '2026-09-19T00:00:00Z' } } },
        ],
      }),
    )
    expect(out).toEqual([
      { provider: 'claude-code', kind: 'five_hour', timestamp: Date.parse('2026-09-15T16:00:00Z'), percentUsed: 6, resetsAt: RESETS },
      { provider: 'claude-code', kind: 'seven_day', timestamp: Date.parse('2026-09-15T16:10:00Z'), percentUsed: 7, resetsAt: Date.parse('2026-09-19T00:00:00Z') },
    ])
  })

  test('anything but the version-1 contract reads as unavailable', () => {
    expect(parseHistory('Usage: ccburn [OPTIONS] COMMAND')).toBeNull()
    expect(parseHistory(JSON.stringify({ version: 2, snapshots: [] }))).toBeNull()
  })

  test('collect stdin uses the status line shape, resets_at in epoch seconds', () => {
    const stdin = collectStdin([{ provider: 'claude-code', kind: 'five_hour', timestamp: NOW, percentUsed: 40, resetsAt: RESETS }])
    expect(JSON.parse(stdin)).toEqual({ rate_limits: { five_hour: { used_percentage: 40, resets_at: RESETS / 1000 } } })
  })
})

describe('sharing history with ccburn', () => {
  test('an idle pane follows ccburn’s history: the gauge moves on the next tick with no measure', async ($, on) => {
    const world = worldOf(on)
    world.rateLimits = limits(10)
    world.ccburnHistory = ccburnHistoryOf([{ at: NOW - 5 * MINUTE, fiveHour: 10 }])
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.settle()

    const mounted = await $.ui.mount(pane('terminal', 80, 30))
    expect(await mounted.find({ type: 'Text', text: '10%' })).toBeDefined()

    // Another session burns the account; only ccburn's history knows.
    world.ccburnHistory = ccburnHistoryOf([
      { at: NOW - 5 * MINUTE, fiveHour: 10 },
      { at: NOW + 30_000, fiveHour: 14 },
    ])
    await clock.advance(MINUTE)
    expect(await mounted.find({ type: 'Text', text: '14%' })).toBeDefined()
    expect(world.runs.filter(r => r.argv[1] === 'history').length).toBeGreaterThanOrEqual(2)
    await mounted.unmount()
  })

  test('a measured reading is handed to ccburn collect once, in the status line shape', async ($, on) => {
    const world = worldOf(on)
    world.ccburnHistory = ccburnHistoryOf([])
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.settle()

    await $.session.measure(measure(limits(40)))
    await clock.settle()

    const collects = world.runs.filter(r => r.argv[1] === 'collect')
    expect(collects).toHaveLength(1)
    const stdin = JSON.parse(collects[0]?.stdin ?? '{}')
    expect(stdin.rate_limits.five_hour).toEqual({ used_percentage: 40, resets_at: RESETS / 1000 })
  })

  test('when ccburn fails it is left alone, and the pane draws from its own readings', async ($, on) => {
    const world = worldOf(on)
    world.rateLimits = limits(22)
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.settle()
    await clock.advance(3 * MINUTE)
    await $.session.measure(measure(limits(23)))
    await clock.settle()

    expect(world.runs).toHaveLength(1)
    const mounted = await $.ui.mount(pane('terminal', 80, 30))
    expect(await mounted.find({ type: 'Text', text: '23%' })).toBeDefined()
    await mounted.unmount()
  })

  test('with useCcburn off, no command runs', { options: { useCcburn: false } }, async ($, on) => {
    const world = worldOf(on)
    world.ccburnHistory = ccburnHistoryOf([{ at: NOW, fiveHour: 50 }])
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(2 * MINUTE)
    await $.session.measure(measure(limits(40)))
    await clock.settle()

    expect(world.runs).toEqual([])
  })
})
