import { describe, expect, test } from 'claude-code/testing'

import { chartCells } from '../hooks/core/chart'
import { burnRate, windowStart, type LimitData, type Snapshot } from '../hooks/core/metrics'
import { GOLDENS } from './fixtures/golden'

const HOURS = { five_hour: 5, seven_day: 168 } as const

type Golden = (typeof GOLDENS)[number]

function inputsOf(golden: Golden) {
  const limit: LimitData = {
    utilization: golden.percentUsed / 100,
    resetsAt: golden.resetsAt,
    windowHours: HOURS[golden.kind as keyof typeof HOURS],
  }
  const snapshots: Snapshot[] = golden.history.map(h => ({ timestamp: h.timestamp, utilization: h.percentUsed / 100 }))

  return { limit, snapshots }
}

const hex = (c: number | null): string => (c === null ? 'none' : `#${c.toString(16).padStart(6, '0')}`)

describe('the chart matches ccburn cell for cell', () => {
  for (const golden of GOLDENS) {
    test(golden.name, async () => {
      const { limit, snapshots } = inputsOf(golden)
      const percentPerHour = burnRate(snapshots, windowStart(limit), limit.windowHours)
      expect(Math.abs(percentPerHour - golden.percentPerHour)).toBeLessThan(1e-9)

      const rows = chartCells({
        limit,
        snapshots,
        percentPerHour,
        now: golden.now,
        width: golden.width,
        height: golden.height,
        offsetAt: () => golden.tzOffsetMinutes,
      })

      expect(rows.map(row => row.map(cell => cell.glyph).join(''))).toEqual(golden.glyphs)

      const colorMismatches: string[] = []
      rows.forEach((row, r) =>
        row.forEach((cell, c) => {
          const expected = golden.colors[r]?.[c] ?? null
          if (cell.glyph !== ' ' && cell.fg !== expected) {
            colorMismatches.push(`row ${r} col ${c} '${cell.glyph}': ${hex(cell.fg)} != ${hex(expected)}`)
          }
        }),
      )
      expect(colorMismatches).toEqual([])
    })
  }
})
