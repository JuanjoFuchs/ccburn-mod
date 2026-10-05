import { describe, expect, test } from 'claude-code/testing'

import { fromStore, limitOf, MAX_READINGS, merge, readingsOf, snapshotsOf } from '../hooks/core/readings'
import type { Reading } from '../types'

const NOW = Date.parse('2026-09-15T16:30:00Z')
const RESETS = Date.parse('2026-09-15T19:00:00Z')
const MINUTE = 60_000

const reading = (minutesAgo: number, percentUsed: number, kind = 'five_hour', resetsAt = RESETS): Reading => ({
  provider: 'claude-code',
  kind,
  timestamp: NOW - minutesAgo * MINUTE,
  percentUsed,
  resetsAt,
})

describe('readings', () => {
  test('the engine’s windows become readings; one with no reset time is skipped', () => {
    const out = readingsOf(
      [
        { kind: 'five_hour', percentUsed: 42.5, resetsAt: '2026-09-15T19:00:00Z' },
        { kind: 'seven_day', percentUsed: 12 },
      ],
      NOW,
    )
    expect(out).toEqual([{ provider: 'claude-code', kind: 'five_hour', timestamp: NOW, percentUsed: 42.5, resetsAt: RESETS }])
  })

  test('merge keys on provider, kind and time; drops readings older than one window', () => {
    const a = [reading(30, 10), reading(20, 12)]
    const b = [reading(20, 12), reading(10, 15)]
    const old = reading(6 * 60, 50, 'five_hour', NOW - 60 * MINUTE)
    expect(merge([old, ...a], b, NOW).map(r => r.percentUsed)).toEqual([10, 12, 15])
  })

  test('a repeat within a minute is not stored twice', () => {
    const first = reading(0.5, 20)
    const repeat = { ...first, timestamp: NOW }
    expect(merge([first], [repeat], NOW)).toHaveLength(1)
    expect(merge([first], [{ ...repeat, percentUsed: 21 }], NOW)).toHaveLength(2)
  })

  test('history is capped at the newest readings', () => {
    const many = Array.from({ length: MAX_READINGS + 50 }, (_, i) => reading(i * 0.02, i % 100))
    const merged = merge(many, [], NOW)
    expect(merged).toHaveLength(MAX_READINGS)
    expect(merged[merged.length - 1]?.timestamp).toBe(NOW)
  })

  test('the store is read defensively', () => {
    expect(fromStore(undefined)).toEqual([])
    expect(fromStore([reading(1, 1), { bad: true }, null])).toEqual([reading(1, 1)])
  })

  test('the latest reading of a window is its limit; all of them its history', () => {
    const rs = [reading(30, 10), reading(25, 5, 'seven_day'), reading(10, 15)]
    expect(limitOf(rs, 'five_hour')).toEqual({ utilization: 0.15, resetsAt: RESETS, windowHours: 5 })
    expect(limitOf(rs, 'seven_day')?.windowHours).toBe(168)
    expect(snapshotsOf(rs, 'five_hour').map(s => s.utilization)).toEqual([0.1, 0.15])
    expect(limitOf([], 'five_hour')).toBeNull()
  })
})
