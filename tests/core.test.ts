import { describe, expect, test } from 'claude-code/testing'

import { formatDuration, formatPercentage, formatResetTime, utilizationColor } from '../hooks/core/format'
import { bar, barWidth, gauges, header, RICH, type Run } from '../hooks/core/gauges'
import { budgetPace, burnRate, effectiveUtilization, minutesToEmpty, paceEmoji, type Snapshot } from '../hooks/core/metrics'
import { build, getLabels } from '../hooks/core/plotext'
import { toFixed } from '../hooks/core/py'

const HOUR = 3_600_000
const MINUTE = 60_000
const NOW = Date.parse('2026-01-08T14:00:00Z')
const UTC = () => 0
const text = (runs: readonly Run[]): string => runs.map(r => r.text).join('')

// Cases carried over from ccburn's tests/test_calculator.py.
describe('metrics (ccburn test_calculator.py)', () => {
  test('budget pace across the window', () => {
    const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.01)
    near(budgetPace(NOW + 5 * HOUR, 5, NOW), 0)
    near(budgetPace(NOW, 5, NOW), 1)
    near(budgetPace(NOW + 2.5 * HOUR, 5, NOW), 0.5)
    expect(budgetPace(NOW - HOUR, 5, NOW)).toBe(1)
    near(budgetPace(NOW + 10 * HOUR, 5, NOW), 0)
  })

  test('burn rate needs history', () => {
    expect(burnRate([], NOW - 5 * HOUR, 5)).toBe(0)
    expect(burnRate([{ timestamp: NOW, utilization: 0.5 }], NOW - 3 * HOUR, 5)).toBe(0)
  })

  test('burn rate is positive for rising usage', () => {
    const rising: Snapshot[] = Array.from({ length: 10 }, (_, i) => ({ timestamp: NOW + i * 30_000, utilization: 0.5 + i * 0.01 }))
    expect(burnRate(rising, Date.parse('2026-01-08T13:55:00Z'), 0.5)).toBeGreaterThan(0)
  })

  test('burn rate is zero for flat usage, and for history spanning under 10 % of the window', () => {
    const flat: Snapshot[] = Array.from({ length: 5 }, (_, i) => ({ timestamp: NOW - (4 - i) * MINUTE, utilization: 0.5 }))
    expect(Math.abs(burnRate(flat, NOW - HOUR, 5))).toBeLessThan(0.1)
  })

  test('minutes to 100 %', () => {
    expect(minutesToEmpty(0.5, 10)).toBe(300)
    expect(minutesToEmpty(0.5, 0)).toBeNull()
    expect(minutesToEmpty(0.5, -5)).toBeNull()
    expect(minutesToEmpty(1, 10)).toBe(0)
  })

  test('pace emoji boundaries at 0.85 and 1.15', () => {
    expect(paceEmoji(0.5, 0)).toBe('🔥')
    expect(paceEmoji(0.84, 1)).toBe('🧊')
    expect(paceEmoji(0.85, 1)).toBe('🔥')
    expect(paceEmoji(1.15, 1)).toBe('🔥')
    expect(paceEmoji(1.16, 1)).toBe('🚨')
  })

  test('an expired window reads 0 %', () => {
    const limit = { utilization: 0.97, resetsAt: NOW - MINUTE, windowHours: 5 }
    expect(effectiveUtilization(limit, NOW)).toBe(0)
    expect(effectiveUtilization({ ...limit, resetsAt: NOW + MINUTE }, NOW)).toBe(0.97)
  })
})

// Cases carried over from ccburn's tests/test_formatting.py.
describe('formatting (ccburn test_formatting.py)', () => {
  test('durations', () => {
    const cases: [number, string][] = [
      [45, '45m'], [1, '1m'], [59, '59m'], [60, '1h'], [120, '2h'], [90, '1h 30m'], [134, '2h 14m'],
      [1440, '1d'], [2880, '2d'], [1500, '1d 1h'], [3000, '2d 2h'], [-10, '0m'], [0, '0m'],
    ]
    for (const [minutes, expected] of cases) {
      expect(formatDuration(minutes)).toBe(expected)
    }
  })

  test('percentages', () => {
    expect(formatPercentage(0.62)).toBe('62%')
    expect(formatPercentage(0.5)).toBe('50%')
    expect(formatPercentage(1)).toBe('100%')
    expect(formatPercentage(0.625, 1)).toBe('62.5%')
    expect(formatPercentage(0.333, 2)).toBe('33.30%')
    expect(formatPercentage(0)).toBe('0%')
  })

  test('reset times', () => {
    expect(formatResetTime(Date.parse('2026-01-08T16:14:00Z'), NOW, UTC)).toBe('Resets in 2h 14m')
    expect(formatResetTime(Date.parse('2026-01-08T14:30:00Z'), NOW, UTC)).toBe('Resets in 30m')
    expect(formatResetTime(Date.parse('2026-01-08T13:00:00Z'), NOW, UTC)).toBe('Reset pending')
    expect(formatResetTime(Date.parse('2026-01-10T16:00:00Z'), NOW, UTC)).toBe('Resets Sat 4:00 PM')
    expect(formatResetTime(Date.parse('2026-01-16T19:00:00Z'), NOW, UTC)).toBe('Resets Fri 1/16 7PM')
    expect(formatResetTime(Date.parse('2026-01-16T19:30:00Z'), NOW, UTC)).toBe('Resets Fri 1/16 7:30 PM')
  })

  test('utilization colours with no pace', () => {
    for (const u of [0, 0.3, 0.49]) expect(utilizationColor(u)).toBe('green')
    for (const u of [0.5, 0.6, 0.74]) expect(utilizationColor(u)).toBe('yellow')
    for (const u of [0.75, 0.8, 0.89]) expect(utilizationColor(u)).toBe('bright_red')
    for (const u of [0.9, 0.95, 1]) expect(utilizationColor(u)).toBe('red')
  })

  test('numbers round as Python rounds them', () => {
    expect(toFixed(62.5, 0)).toBe('62')
    expect(toFixed(63.5, 0)).toBe('64')
    expect(toFixed(0.125, 2)).toBe('0.12')
    expect(toFixed(16.666666666666668, 1)).toBe('16.7')
    expect(getLabels([0, 100 / 6, 200 / 6, 50, 400 / 6, 500 / 6, 100])).toEqual(['0.0', '16.7', '33.3', '50.0', '66.7', '83.3', '100.0'])
    expect(getLabels([0, 10, 20, 30, 40, 50, 60])).toEqual(['0', '10', '20', '30', '40', '50', '60'])
  })
})

describe('x tick labels', () => {
  test('overlapping labels resolve in ascending position, and a dropped label loses its tick', () => {
    const rows = build({
      width: 40,
      height: 8,
      xlim: [0, 10],
      ylim: [0, 100],
      xticks: [5.2, 5],
      xlabels: ['later', 'first'],
      signals: [{ x: [0, 10], y: [0, 100], color: 0x646464, marker: 'braille' }],
      ticksColor: 0x646464,
    })
    const labels = rows[rows.length - 1]?.map(c => c.glyph).join('') ?? ''
    const axis = rows[rows.length - 2]?.map(c => c.glyph).join('') ?? ''
    expect(labels).toContain('first')
    expect(labels).not.toContain('later')
    expect(axis.split('┬')).toHaveLength(2)
  })
})

// The header and gauges ccburn draws at 40 % used, half way through a 5-hour window.
describe('header and gauges (ccburn gauges.py)', () => {
  const limit = { utilization: 0.4, resetsAt: NOW + 2.5 * HOUR, windowHours: 5 }

  test('header', () => {
    const h = header('Session (5h)', limit, NOW, UTC)
    expect(text(h.left)).toBe('🧊 ccburn - Session (5h)')
    expect(text(h.right)).toBe('⏰ Resets in 2h 30m')
    expect(h.left[1]).toEqual({ text: 'ccburn', color: RICH.magenta, bold: true })
  })

  test('loading header and gauges', () => {
    const h = header('Weekly', null, NOW, UTC)
    expect(text(h.left)).toBe('🔥 ccburn - Weekly')
    expect(text(h.right)).toBe('⏳ Loading...')
    const [usage, elapsed] = gauges(null, NOW, 80)
    expect(text(usage.value)).toBe('--%')
    expect(text(elapsed.label)).toBe('⏳ Elapsed')
    expect(text(usage.bar)).toBe('━'.repeat(60))
  })

  test('bars at 80 and 60 columns (a 4-cell value column, not ccburn’s 18)', () => {
    expect(barWidth(80)).toBe(60)
    expect(barWidth(60)).toBe(40)
    const [usage, elapsed] = gauges(limit, NOW, 80)
    expect(text(usage.bar)).toBe(`${'━'.repeat(24)}╺${'━'.repeat(35)}`)
    expect(text(elapsed.bar)).toBe(`${'━'.repeat(30)}╺${'━'.repeat(29)}`)
    expect(text(usage.value)).toBe('40%')
    expect(text(elapsed.value)).toBe('50%')
    expect(usage.value[0]?.color).toBe(RICH.green)
    expect(elapsed.value[0]?.color).toBe(RICH.blue)
  })

  test('a half-filled cell and a full bar', () => {
    expect(text(bar(10, 25, RICH.green))).toBe('━━╸━━━━━━━')
    const full = bar(10, 100, RICH.red)
    expect(text(full)).toBe('━'.repeat(10))
    expect(full[0]?.color).toBe(RICH.finished)
  })
})
