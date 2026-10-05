/**
 * The two contracts the mod shares history through when ccburn is installed
 * (spec 002): `ccburn history --json` to read, `ccburn collect` to write.
 */

import type { Reading } from '../../types'
import { PROVIDER } from './readings'

export const HISTORY_ARGV = ['ccburn', 'history', '--json', '--changes-only', '--since-hours', '168'] as const
export const COLLECT_ARGV = ['ccburn', 'collect'] as const

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/**
 * Readings from `ccburn history --json` output, or null when the output is not
 * that contract (wrong version, not JSON): the caller then treats ccburn as
 * unavailable. Malformed snapshots and limits are skipped.
 */
export function parseHistory(stdout: string): Reading[] | null {
  let data: unknown

  try {
    data = JSON.parse(stdout)
  } catch {
    return null
  }

  if (!isObject(data) || data.version !== 1 || !Array.isArray(data.snapshots)) {
    return null
  }

  const readings: Reading[] = []

  for (const snapshot of data.snapshots) {
    if (!isObject(snapshot) || typeof snapshot.timestamp !== 'string' || !isObject(snapshot.limits)) {
      continue
    }

    const timestamp = Date.parse(snapshot.timestamp)
    if (!Number.isFinite(timestamp)) {
      continue
    }

    for (const [kind, limit] of Object.entries(snapshot.limits)) {
      if (!isObject(limit) || typeof limit.used_percentage !== 'number' || typeof limit.resets_at !== 'string') {
        continue
      }

      const resetsAt = Date.parse(limit.resets_at)
      if (Number.isFinite(resetsAt)) {
        readings.push({ provider: PROVIDER, kind, timestamp, percentUsed: limit.used_percentage, resetsAt })
      }
    }
  }

  return readings
}

/** Status-line JSON for `ccburn collect`: `resets_at` in epoch seconds, as Claude Code sends it. */
export function collectStdin(readings: readonly Reading[]): string {
  const rateLimits: Record<string, { used_percentage: number; resets_at: number }> = {}

  for (const r of readings) {
    rateLimits[r.kind] = { used_percentage: r.percentUsed, resets_at: Math.round(r.resetsAt / 1000) }
  }

  return JSON.stringify({ rate_limits: rateLimits })
}
