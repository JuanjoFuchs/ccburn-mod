/** Ports of ccburn's pace and burn math (`utils/calculator.py`, `get_pace_emoji`). */

const HOUR = 3_600_000

/** A window's current reading: utilization 0–1 and when it resets, in epoch ms. */
export type LimitData = {
  utilization: number
  resetsAt: number
  windowHours: number
}

/** One point of history for a window: when, and utilization 0–1. */
export type Snapshot = {
  timestamp: number
  utilization: number
}

export const windowStart = (limit: LimitData): number => limit.resetsAt - limit.windowHours * HOUR

export const isExpired = (limit: LimitData, now: number): boolean => now > limit.resetsAt

/** Utilization, or 0 once the window has reset (the API can report a stale window). */
export const effectiveUtilization = (limit: LimitData, now: number): number =>
  isExpired(limit, now) ? 0 : limit.utilization

/** `calculate_budget_pace`: the elapsed fraction of the window, clamped to 0–1. */
export function budgetPace(resetsAt: number, windowHours: number, now: number): number {
  const start = resetsAt - windowHours * HOUR
  const elapsed = (now - start) / 1000
  const windowSeconds = windowHours * 3600

  if (windowSeconds <= 0) {
    return 0
  }

  return Math.max(0, Math.min(1, elapsed / windowSeconds))
}

/**
 * `calculate_burn_rate`: percentage points per hour by least squares over the
 * snapshots inside the window; 0 when there are too few or they span too
 * little of it.
 */
export function burnRate(
  snapshots: readonly Snapshot[],
  start: number,
  windowHours: number,
  minPoints = 3,
  minSpanPct = 0.1,
): number {
  if (snapshots.length < 2) {
    return 0
  }

  const points: [number, number][] = []
  let first: number | null = null
  let last: number | null = null

  for (const s of snapshots) {
    if (s.timestamp < start) {
      continue
    }

    if (first === null) {
      first = s.timestamp
    }

    last = s.timestamp
    points.push([(s.timestamp - first) / 1000 / 3600, s.utilization * 100])
  }

  if (points.length < minPoints) {
    return 0
  }

  if (first !== null && last !== null) {
    const spanHours = (last - first) / 1000 / 3600
    const minSpanHours = Math.min(windowHours * minSpanPct, 6)

    if (spanHours < minSpanHours) {
      return 0
    }
  }

  if (points.length === 2) {
    const [a, b] = points as [[number, number], [number, number]]
    const dx = b[0] - a[0]

    return dx <= 0 ? 0 : (b[1] - a[1]) / dx
  }

  const n = points.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumX2 = 0

  for (const [x, y] of points) {
    sumX += x
    sumY += y
    sumXY += x * y
    sumX2 += x ** 2
  }

  const denominator = n * sumX2 - sumX ** 2

  if (Math.abs(denominator) < 1e-10) {
    return 0
  }

  return (n * sumXY - sumX * sumY) / denominator
}

/** `estimate_time_to_empty`: minutes until 100 %, or null when not burning. */
export function minutesToEmpty(utilization: number, percentPerHour: number): number | null {
  if (percentPerHour <= 0) {
    return null
  }

  const remaining = 100 - utilization * 100

  if (remaining <= 0) {
    return 0
  }

  return Math.trunc((remaining / percentPerHour) * 60)
}

export type PaceEmoji = '🧊' | '🔥' | '🚨'

/** `get_pace_emoji`: under 0.85 of pace is cool, over 1.15 is too hot. */
export function paceEmoji(utilization: number, pace: number): PaceEmoji {
  if (pace === 0) {
    return '🔥'
  }

  const ratio = utilization / pace

  if (ratio < 0.85) {
    return '🧊'
  }

  return ratio > 1.15 ? '🚨' : '🔥'
}
