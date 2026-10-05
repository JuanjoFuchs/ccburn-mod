/**
 * Port of ccburn's `BurnupChart._create_chart` (`display/chart.py`) for the
 * default view: the whole window, from its start to its reset.
 */

import { dayHour, hourMinute, localTime, monthDay, monthDayHour, roundToMinute, type OffsetAt } from './clock'
import { utilizationColor } from './format'
import { effectiveUtilization, windowStart, type LimitData, type Snapshot } from './metrics'
import { build, type Cell, type Color, type Signal } from './plotext'

const HOUR = 3_600_000

/** ccburn's `_get_plotext_color` map. */
const USAGE_RGB = { green: 0x00ff00, yellow: 0xffff00, bright_red: 0xffa500, red: 0xff0000 } as const

export const COLORS = {
  ticks: 0x646464,
  pace: 0x646464,
  projectionHot: 0xff6400,
  projectionSafe: 0x64c864,
  now: 0x0078ff,
  depleted: 0xff6400,
} as const

export type ChartInput = {
  limit: LimitData
  snapshots: readonly Snapshot[]
  /** Burn rate from `burnRate`, in percentage points per hour. */
  percentPerHour: number
  now: number
  width: number
  height: number
  offsetAt: OffsetAt
}

/** Python's `timedelta(hours=h)` rounds to the microsecond, half to even. */
function hoursToMs(hours: number): number {
  const whole = Math.trunc(hours)
  const fraction = (hours - whole) * 3_600_000_000
  const floor = Math.floor(fraction)
  const rest = fraction - floor
  const us = rest > 0.5 || (rest === 0.5 && floor % 2 !== 0) ? floor + 1 : floor

  return whole * HOUR + us / 1000
}

const toHoursSince = (start: number) => (t: number) => (t - start) / 1000 / 3600

/** The chart's cells, rows top-down, `max(width, 40)` × `max(height, 8)`. */
export function chartCells(input: ChartInput): Cell[][] {
  const { limit, snapshots, percentPerHour, now, offsetAt } = input
  const width = Math.max(input.width, 40)
  const height = Math.max(input.height, 8)

  const originalStart = windowStart(limit)
  const originalHours = limit.windowHours
  const displayStart = originalStart
  const displayEnd = limit.resetsAt
  const toHours = toHoursSince(displayStart)
  const displayHours = toHours(displayEnd)
  const effective = effectiveUtilization(limit, now)

  const relevant = snapshots.filter(s => displayStart <= s.timestamp && s.timestamp <= now)

  // Budget pace, against the original window.
  const paceX: number[] = []
  const paceY: number[] = []
  for (let i = 0; i < 50; i += 1) {
    const xHours = (i * displayHours) / 49
    paceX.push(xHours)
    const pointTime = displayStart + hoursToMs(xHours)
    const elapsed = (pointTime - originalStart) / 1000 / 3600
    paceY.push(Math.min((elapsed / originalHours) * 100, 100))
  }

  const signals: Signal[] = [{ x: paceX, y: paceY, color: COLORS.pace, marker: 'braille', label: 'Budget Pace' }]

  // Actual usage.
  const values: number[] = []
  const times: number[] = []
  for (const s of relevant) {
    const pct = Math.min(s.utilization * 100, 100)
    if (s.utilization > 1) {
      continue
    }

    times.push(toHours(s.timestamp))
    values.push(pct)
  }

  if (times.length > 0) {
    const elapsedHours = (now - originalStart) / 1000 / 3600
    const pace = Math.min(elapsedHours / originalHours, 1)
    signals.push({ x: times, y: values, color: USAGE_RGB[utilizationColor(effective, pace)], marker: 'braille', fillx: true, label: 'Usage' })
  }

  // Projection.
  let hits100Hours: number | null = null
  const showProjection = displayEnd > now
  if (percentPerHour > 0 && showProjection) {
    const currentPct = effective * 100
    const nowHours = toHours(now)

    if (currentPct < 100) {
      const hoursTo100 = (100 - currentPct) / percentPerHour
      const remainingWindowHours = (displayEnd - now) / 1000 / 3600
      let endHours: number
      let endPct: number
      let color: Color

      if (hoursTo100 <= remainingWindowHours) {
        endHours = nowHours + hoursTo100
        endPct = 100
        color = COLORS.projectionHot
        hits100Hours = endHours
      } else {
        endHours = nowHours + remainingWindowHours
        endPct = currentPct + percentPerHour * remainingWindowHours
        color = COLORS.projectionSafe
      }

      signals.push({ x: [nowHours, endHours], y: [currentPct, Math.min(endPct, 100)], color, marker: 'braille', label: 'Projection' })
    }
  }

  // Y range: the data, padded, at least 10 points tall, inside 0–100.
  const all = [...values, ...paceY]
  if (hits100Hours !== null) {
    all.push(100)
  } else if (percentPerHour > 0) {
    const currentPct = effective * 100
    const remainingWindowHours = (displayEnd - now) / 1000 / 3600
    all.push(Math.min(currentPct + percentPerHour * remainingWindowHours, 100))
  }

  let yMin = 0
  let yMax = 100
  if (all.length > 0) {
    const dataMin = Math.min(...all)
    const dataMax = Math.max(...all)
    const padding = Math.max((dataMax - dataMin) * 0.1, 1)
    yMin = Math.max(0, dataMin - padding)
    yMax = Math.min(100, dataMax + padding)

    if (yMax - yMin < 10) {
      const mid = (yMin + yMax) / 2
      yMin = Math.max(0, mid - 5)
      yMax = Math.min(100, mid + 5)
    }
  }

  const dots = (x: number): Signal['x'] => Array.from({ length: 20 }, () => x)
  const dotY = Array.from({ length: 20 }, (_, i) => yMin + (i * (yMax - yMin)) / 19)

  let nowTick: number | null = null
  if (showProjection) {
    const nowHours = toHours(now)
    if (0 < nowHours && nowHours < displayHours) {
      signals.push({ x: dots(nowHours), y: dotY, color: COLORS.now, marker: 'braille', label: 'Now' })
      nowTick = nowHours
    }
  }

  let depletedTick: number | null = null
  if (hits100Hours !== null && 0 < hits100Hours && hits100Hours < displayHours) {
    signals.push({ x: dots(hits100Hours), y: dotY, color: COLORS.depleted, marker: 'braille', label: 'Depleted' })
    depletedTick = hits100Hours
  }

  // The hidden point that switches the right y axis on.
  signals.push({ x: [displayHours], y: [yMax], color: null, marker: ' ', yside: 'right' })

  // X ticks in local time.
  const format = (ms: number, isMarker: boolean): string => {
    const local = localTime(roundToMinute(ms), offsetAt)

    if (displayHours > 168) {
      return isMarker ? monthDayHour(local) : monthDay(local)
    }

    return displayHours > 24 ? dayHour(local) : hourMinute(local)
  }

  let positions: number[] = []
  let labels: string[] = []
  for (let i = 0; i < 5; i += 1) {
    const hours = (i * displayHours) / 4
    positions.push(hours)
    labels.push(format(displayStart + hoursToMs(hours), false))
  }

  const addMarkerTick = (at: number, ms: number) => {
    const minDistance = displayHours / 10
    const keep = positions.map((p, i) => ({ p, l: labels[i] ?? '' })).filter(({ p }) => Math.abs(at - p) >= minDistance)
    positions = [...keep.map(k => k.p), at]
    labels = [...keep.map(k => k.l), format(ms, true)]
  }

  if (nowTick !== null) {
    addMarkerTick(nowTick, now)
  }

  if (depletedTick !== null) {
    addMarkerTick(depletedTick, displayStart + hoursToMs(depletedTick))
  }

  return build({
    width,
    height,
    xlim: [0, displayHours],
    ylim: [yMin, yMax],
    xticks: positions,
    xlabels: labels,
    signals,
    ticksColor: COLORS.ticks,
  })
}
