/**
 * The pane, laid out as ccburn's full layout (`display/layout.py`): a header
 * row, the Usage and Elapsed gauges, then the chart filling the rest, with a
 * row for the window toggle at the bottom.
 */

import type { Elements, RenderElement, RenderNode } from 'claude-code'

import type { WindowKind } from '../../types'
import { chartCells } from '../core/chart'
import type { OffsetAt } from '../core/clock'
import { barWidth, cellWidth, DISPLAY_NAME, gauges, header, type Run } from '../core/gauges'
import { burnRate, windowStart, type LimitData, type Snapshot } from '../core/metrics'
import { packCells } from '../core/raster'

/** The elements the pane draws with; `Raster` only where the surface has it. */
export type Kit = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button'> & Partial<Pick<Elements['terminal'], 'Raster'>>

/** ccburn drops the chart below this size (its compact layout). */
export const MIN_COLUMNS = 40
export const MIN_ROWS = 15

/** Header, two gauges and the toggle row. */
const CHROME_ROWS = 4

export type PaneModel = {
  kind: WindowKind
  limit: LimitData | null
  snapshots: readonly Snapshot[]
  isWithoutLimits: boolean
  now: number
  columns: number
  rows: number
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

export function drawPane(kit: Kit, model: PaneModel): RenderElement {
  const { Box, Text, Button, Raster } = kit
  const width = Math.max(1, model.columns)
  const name = DISPLAY_NAME[model.kind]
  const head = header(name, model.limit, model.now, model.offsetAt)
  const leftWidth = Math.ceil(width / 2)
  const rightWidth = width - leftWidth
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

  const chartRows = model.rows - CHROME_ROWS
  let body: RenderNode[] = []

  if (!model.limit) {
    body = [<Text dimColor>{model.isWithoutLimits ? MESSAGES.withoutLimits : MESSAGES.waiting}</Text>]
  } else if (model.columns < MIN_COLUMNS || model.rows < MIN_ROWS) {
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
  }

  const other: WindowKind = model.kind === 'five_hour' ? 'seven_day' : 'five_hour'

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {runs(kit, padded(head.left, leftWidth))}
        {runs(kit, rightAligned(head.right, rightWidth))}
      </Box>
      {gaugeRow(usage)}
      {gaugeRow(elapsed)}
      {body}
      <Box flexDirection="row">
        <Button key="window" label={`Show ${DISPLAY_NAME[other]}`} hotkey="w" plain onPress={model.onToggle} />
      </Box>
    </Box>
  )
}
