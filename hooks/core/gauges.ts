/**
 * Ports of ccburn's header and gauge rows (`display/gauges.py`), as runs of
 * styled text the pane draws with `Text`. Rich's named colours are given in
 * the Windows Terminal "Campbell" palette, which is how ccburn reads there.
 */

import type { OffsetAt } from './clock'
import { formatResetTime, utilizationColor, type UtilizationColor } from './format'
import { budgetPace, effectiveUtilization, paceEmoji, type LimitData } from './metrics'
import { toFixed } from './py'

export type Run = { text: string; color?: string; bold?: boolean; dim?: boolean }

export const RICH = {
  magenta: '#881798',
  cyan: '#3a96dd',
  yellow: '#c19c00',
  blue: '#0037da',
  green: '#13a10e',
  red: '#c50f1f',
  bright_red: '#e74856',
  grey37: '#5f5f5f',
  /** Rich's default `bar.finished`, which ccburn's bars fall back to at 100 %. */
  finished: '#729c1f',
} as const

const usageHex = (color: UtilizationColor): string => RICH[color]

export const DISPLAY_NAME = { five_hour: 'Session (5h)', seven_day: 'Weekly' } as const

/** Display width of a run of text: the emoji ccburn uses take two cells. */
export function cellWidth(text: string): number {
  let width = 0

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    width += code >= 0x1f000 || char === '⏰' || char === '⏳' ? 2 : 1
  }

  return width
}

export type Header = { left: Run[]; right: Run[] }

/** `create_header` */
export function header(name: string, limit: LimitData | null, now: number, offsetAt: OffsetAt): Header {
  const emoji = limit ? paceEmoji(effectiveUtilization(limit, now), budgetPace(limit.resetsAt, limit.windowHours, now)) : '🔥'
  const left: Run[] = [
    { text: `${emoji} ` },
    { text: 'ccburn', color: RICH.magenta, bold: true },
    { text: ' - ', dim: true },
    { text: name, color: RICH.cyan, bold: true },
  ]
  const right: Run[] = limit
    ? [{ text: '⏰ ' }, { text: formatResetTime(limit.resetsAt, now, offsetAt), color: RICH.yellow }]
    : [{ text: '⏳ Loading...', dim: true }]

  return { left, right }
}

/** Rich's `ProgressBar` at `width` cells: `━` filled, `╸` half, `╺` boundary. */
export function bar(width: number, completed: number, complete: string, back = RICH.grey37): Run[] {
  const clamped = Math.min(100, Math.max(0, completed))
  const halves = Math.trunc((width * 2 * clamped) / 100)
  const bars = Math.floor(halves / 2)
  const half = halves % 2
  const fill = completed >= 100 ? RICH.finished : complete
  const runs: Run[] = []

  if (bars) {
    runs.push({ text: '━'.repeat(bars), color: fill })
  }

  if (half) {
    runs.push({ text: '╸', color: fill })
  }

  let remaining = width - bars - half
  if (remaining > 0) {
    if (!half && bars) {
      runs.push({ text: '╺', color: back })
      remaining -= 1
    }

    if (remaining > 0) {
      runs.push({ text: '━'.repeat(remaining), color: back })
    }
  }

  return runs
}

export type GaugeRow = { label: Run[]; bar: Run[]; value: Run[] }

/** The label column, as ccburn draws it. */
export const LABEL_WIDTH = 14

/**
 * The value column. ccburn reserves 18 for monthly dollar amounts
 * (`$74.75 / $300.00`); the mod only shows percentages (`100%`), so it keeps
 * 4 and gives the rest to the bars.
 */
export const VALUE_WIDTH = 4

/** The width of the bar column in a gauge row `width` cells wide (one-cell gaps either side). */
export const barWidth = (width: number): number => Math.max(1, width - LABEL_WIDTH - VALUE_WIDTH - 2)

/** `create_gauge_section`: the Usage and Elapsed rows. */
export function gauges(limit: LimitData | null, now: number, width: number): [GaugeRow, GaugeRow] {
  const w = barWidth(width)

  if (!limit) {
    return [
      { label: [{ text: '📊 Usage', dim: true }], bar: bar(w, 0, RICH.grey37), value: [{ text: '--%', dim: true }] },
      { label: [{ text: '⏳ Elapsed', dim: true }], bar: bar(w, 0, RICH.grey37), value: [{ text: '--%', dim: true }] },
    ]
  }

  const pace = budgetPace(limit.resetsAt, limit.windowHours, now)
  const utilization = effectiveUtilization(limit, now)
  const usagePercent = utilization * 100
  const pacePercent = pace * 100
  const color = usageHex(utilizationColor(utilization, pace))

  return [
    {
      label: [{ text: '📊 ' }, { text: 'Usage', color, bold: true }],
      bar: bar(w, usagePercent, color),
      value: [{ text: `${toFixed(usagePercent, 0)}%`, color }],
    },
    {
      label: [{ text: '⏳ ' }, { text: 'Elapsed', color: RICH.blue, bold: true }],
      bar: bar(w, pacePercent, RICH.blue),
      value: [{ text: `${toFixed(pacePercent, 0)}%`, color: RICH.blue }],
    },
  ]
}
