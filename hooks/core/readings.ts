/**
 * Readings: what the engine reports for each rate-limit window, kept as
 * history so the chart and the burn rate reach back past this session.
 */

import type { SessionRateLimit } from 'claude-code'

import type { Reading, WindowKind } from '../../types'
import type { LimitData, Snapshot } from './metrics'

export const PROVIDER = 'claude-code'

/** Hours in each window the pane draws. */
export const WINDOW_HOURS: Record<WindowKind, number> = { five_hour: 5, seven_day: 168 }

/** How long a reading of a window the pane does not draw is kept. */
const OTHER_KEEP_MS = 7 * 24 * 3_600_000

export const MAX_READINGS = 5_000

/** A repeat of the last reading of a window within this long is not stored again. */
const REPEAT_MS = 60_000

const keyOf = (r: Reading): string => `${r.provider}|${r.kind}|${r.timestamp}`

/** The engine's rate limits at `now`, as readings. A window with no reset time is skipped. */
export function readingsOf(rateLimits: readonly SessionRateLimit[], now: number): Reading[] {
  return rateLimits.flatMap(limit => {
    const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)

    return Number.isFinite(resetsAt) && Number.isFinite(limit.percentUsed)
      ? [{ provider: PROVIDER, kind: limit.kind, timestamp: now, percentUsed: limit.percentUsed, resetsAt }]
      : []
  })
}

const windowMsOf = (kind: string): number =>
  kind in WINDOW_HOURS ? WINDOW_HOURS[kind as WindowKind] * 3_600_000 : OTHER_KEEP_MS

/**
 * Merges two histories by `(provider, kind, timestamp)`, drops readings older
 * than one window length (they cannot fall in the window being drawn), drops
 * repeats, and keeps the newest `MAX_READINGS`. Oldest first.
 */
export function merge(a: readonly Reading[], b: readonly Reading[], now: number): Reading[] {
  const byKey = new Map<string, Reading>()
  for (const r of [...a, ...b]) {
    byKey.set(keyOf(r), r)
  }

  const sorted = [...byKey.values()].sort((x, y) => x.timestamp - y.timestamp || x.kind.localeCompare(y.kind))
  const lastOf = new Map<string, Reading>()
  const kept: Reading[] = []

  for (const r of sorted) {
    if (r.timestamp < now - windowMsOf(r.kind)) {
      continue
    }

    const last = lastOf.get(`${r.provider}|${r.kind}`)
    const isRepeat =
      last !== undefined &&
      last.percentUsed === r.percentUsed &&
      last.resetsAt === r.resetsAt &&
      r.timestamp - last.timestamp < REPEAT_MS

    if (isRepeat) {
      continue
    }

    lastOf.set(`${r.provider}|${r.kind}`, r)
    kept.push(r)
  }

  return kept.slice(-MAX_READINGS)
}

/** Parses whatever the store holds into readings, dropping anything malformed. */
export function fromStore(value: unknown): Reading[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(
    (r): r is Reading =>
      typeof r === 'object' &&
      r !== null &&
      typeof r.provider === 'string' &&
      typeof r.kind === 'string' &&
      typeof r.timestamp === 'number' &&
      typeof r.percentUsed === 'number' &&
      typeof r.resetsAt === 'number',
  )
}

/** The latest reading of `kind` as the chart's limit, or null when there is none. */
export function limitOf(readings: readonly Reading[], kind: WindowKind): LimitData | null {
  for (let i = readings.length - 1; i >= 0; i -= 1) {
    const r = readings[i]
    if (r && r.kind === kind && r.provider === PROVIDER) {
      return { utilization: r.percentUsed / 100, resetsAt: r.resetsAt, windowHours: WINDOW_HOURS[kind] }
    }
  }

  return null
}

/** Every reading of `kind` as chart snapshots, oldest first. */
export const snapshotsOf = (readings: readonly Reading[], kind: WindowKind): Snapshot[] =>
  readings.filter(r => r.kind === kind && r.provider === PROVIDER).map(r => ({ timestamp: r.timestamp, utilization: r.percentUsed / 100 }))
