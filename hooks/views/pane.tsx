/**
 * The pane, laid out as ccburn's full layout (`display/layout.py`): a header
 * row, the Usage and Elapsed gauges, then the chart filling the rest, with a
 * row for the window toggle at the bottom.
 */

import type { Elements, RenderElement, RenderNode } from 'claude-code'

import type { WindowKind } from '../../types'
import { chartCells } from '../core/chart'
import type { OffsetAt } from '../core/clock'
import { barWidth, cellWidth, DISPLAY_NAME, gauges, header, type Header, type Run } from '../core/gauges'
import { burnRate, windowStart, type LimitData, type Snapshot } from '../core/metrics'
import { packCells } from '../core/raster'

/** The elements the pane draws with; `Raster` only where the surface has it. */
export type Kit = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button'> & Partial<Pick<Elements['terminal'], 'Raster'>>

/** ccburn drops the chart below this size (its compact layout). */
export const MIN_COLUMNS = 40
export const MIN_ROWS = 15

/** The header (which carries the window toggle) and the two gauges. */
const CHROME_ROWS = 3

/** The toggle's hotkey; a plain Button draws as `w: <label>`. */
const TOGGLE_KEY = 'w'

/**
 * Inline above the prompt, a pane's body is never taller than what it draws.
 * So the pane first draws this many rows (padding below the chart); the body
 * rows it is then given are the room, and from then on it draws exactly that,
 * leaving nothing to scroll.
 */
export const INLINE_CHART_ROWS = 20
export const INLINE_ROWS = INLINE_CHART_ROWS + CHROME_ROWS

export type PaneModel = {
  kind: WindowKind
  limit: LimitData | null
  snapshots: readonly Snapshot[]
  isWithoutLimits: boolean
  now: number
  columns: number
  rows: number
  /** `inline` above the prompt, or `dock`ed beside a fullscreen transcript. */
  placement: 'dock' | 'inline'
  offsetAt: OffsetAt
  onToggle: () => void
}

export const MESSAGES = {
  waiting: "Waiting for Claude Code's first rate-limit reading; it arrives with the next reply.",
  withoutLimits: "This account reports no rate-limit windows to Claude Code (Enterprise and API plans don't), so there is nothing to chart.",
  tooSmall: 'Pane too small for chart. Widen or heighten it.',
} as const

function runs(kit: Kit, list: readonly Run[]): RenderNode[] {
  const { Text } = kit

  return list.map(run => (
    <Text color={run.color} bold={run.bold} dimColor={run.dim}>
      {run.text}
    </Text>
  ))
}

/** Pads a run list on the right to `width` cells, as a Rich table column does. */
function padded(list: readonly Run[], width: number): Run[] {
  const used = list.reduce((sum, run) => sum + cellWidth(run.text), 0)

  return used >= width ? [...list] : [...list, { text: ' '.repeat(width - used) }]
}

/** Pads on the left, for a right-justified column. */
function rightAligned(list: readonly Run[], width: number): Run[] {
  const used = list.reduce((sum, run) => sum + cellWidth(run.text), 0)

  return used >= width ? [...list] : [{ text: ' '.repeat(width - used) }, ...list]
}

/** The toggle's short label for a narrow pane. */
const SHORT_NAME: Record<WindowKind, string> = { five_hour: '5h', seven_day: 'Weekly' }

const widthOf = (list: readonly Run[]): number => list.reduce((sum, run) => sum + cellWidth(run.text), 0)

type FittedHeader = { title: Run[]; toggle: string; right: Run[]; leftWidth: number }

/**
 * The header's parts at the most detail that fits `width` on one row: the full
 * title and toggle; then a short toggle; then the title without `ccburn - `;
 * then without the reset countdown.
 */
export function fitHeader(head: Header, width: number, toggle: string, shortToggle: string): FittedHeader {
  const shortTitle = [head.left[0] ?? { text: '' }, head.left[3] ?? { text: '' }]
  const tries: [Run[], string, Run[]][] = [
    [head.left, toggle, head.right],
    [head.left, shortToggle, head.right],
    [shortTitle, shortToggle, head.right],
    [shortTitle, shortToggle, []],
  ]

  for (const [title, label, right] of tries) {
    const leftWidth = widthOf(title) + 2 + `${TOGGLE_KEY}: ${label}`.length
    const rightWidth = widthOf(right)

    if (leftWidth + (rightWidth > 0 ? 1 + rightWidth : 0) <= width) {
      return { title, toggle: label, right, leftWidth }
    }
  }

  const [title, label] = [shortTitle, shortToggle]

  return { title, toggle: label, right: [], leftWidth: widthOf(title) + 2 + `${TOGGLE_KEY}: ${label}`.length }
}

export function drawPane(kit: Kit, model: PaneModel): RenderElement {
  const { Box, Text, Button, Raster } = kit
  const width = Math.max(1, model.columns)
  const name = DISPLAY_NAME[model.kind]
  const head = header(name, model.limit, model.now, model.offsetAt)
  const [usage, elapsed] = gauges(model.limit, model.now, width)
  const bar = barWidth(width)

  const gaugeRow = (row: typeof usage) => (
    <Box flexDirection="row">
      {runs(kit, padded(row.label, 14))}
      <Text> </Text>
      {runs(kit, padded(row.bar, bar))}
      <Text> </Text>
      {runs(kit, rightAligned(row.value, 18))}
    </Box>
  )

  const isInline = model.placement === 'inline'
  // Inline, rows under INLINE_ROWS mean the room is short, not that the content was.
  const chartRows = model.rows - CHROME_ROWS
  const isTooSmall = model.columns < MIN_COLUMNS || chartRows < (isInline ? 8 : MIN_ROWS - CHROME_ROWS)
  let body: RenderNode[] = []
  let bodyRows = 1

  if (!model.limit) {
    body = [<Text dimColor>{model.isWithoutLimits ? MESSAGES.withoutLimits : MESSAGES.waiting}</Text>]
  } else if (isTooSmall) {
    body = [<Text dimColor>{MESSAGES.tooSmall}</Text>]
  } else if (Raster !== undefined) {
    const percentPerHour = burnRate(model.snapshots, windowStart(model.limit), model.limit.windowHours)
    const cells = chartCells({
      limit: model.limit,
      snapshots: model.snapshots,
      percentPerHour,
      now: model.now,
      width,
      height: chartRows,
      offsetAt: model.offsetAt,
    })
    // chartCells never draws under 40 × 8; crop to the pane so nothing overflows.
    const fitted = cells.slice(0, chartRows).map(row => row.slice(0, width))
    const packed = packCells(fitted)
    body = [<Raster key="chart" columns={packed.columns} rows={packed.rows} cells={packed.cells} />]
    bodyRows = packed.rows
  } else {
    bodyRows = 0
  }

  // Inline, the pane draws exactly `rows` tall (the caller's measured room, or
  // INLINE_ROWS while it is still finding out), padding under a short body.
  const padding = isInline ? Math.max(0, model.rows - CHROME_ROWS - bodyRows) : 0

  // The window toggle rides in the header after the title, so it costs no row.
  // A header that overflows wraps onto a second row and makes the pane scroll,
  // so in a narrow pane it sheds detail until it fits on one.
  const other: WindowKind = model.kind === 'five_hour' ? 'seven_day' : 'five_hour'
  const fit = fitHeader(head, width, `Show ${DISPLAY_NAME[other]}`, SHORT_NAME[other])

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {runs(kit, fit.title)}
        <Text>{'  '}</Text>
        <Button key="window" label={fit.toggle} hotkey={TOGGLE_KEY} plain onPress={model.onToggle} />
        {runs(kit, rightAligned(fit.right, width - fit.leftWidth))}
      </Box>
      {gaugeRow(usage)}
      {gaugeRow(elapsed)}
      {body}
      {padding > 0 ? <Box height={padding} /> : []}
    </Box>
  )
}
