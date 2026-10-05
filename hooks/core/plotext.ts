/**
 * A faithful port of the slice of plotext 5.3.2 that ccburn's chart uses:
 * `build_plot` from `_build.py`, the matrix from `_matrix.py` and the helpers
 * from `_utility.py`. Limited to what the chart needs: a full frame, lower
 * x ticks set by the caller, automatic y ticks on both sides, braille or
 * single-character markers, lines between points, `fillx`, and the legend.
 *
 * The one deliberate difference: plotext keeps user x ticks in a set, so
 * which of two colliding labels survives varies with Python's hash seed.
 * Here ticks are inserted in ascending position, so the result is stable.
 */

import { floorDiv, mod, plotextRound, toFixed } from './py'

/** A colour as 0xRRGGBB, or null for the terminal default. */
export type Color = number | null

export type Cell = { glyph: string; fg: Color }

export type Signal = {
  x: readonly number[]
  y: readonly number[]
  color: Color
  /** `braille` packs 2 × 4 sub-pixels per cell; any other string is drawn as itself. */
  marker: 'braille' | string
  fillx?: boolean
  label?: string
  yside?: 'left' | 'right'
}

export type Figure = {
  width: number
  height: number
  xlim: readonly [number, number]
  ylim: readonly [number, number]
  xticks: readonly number[]
  xlabels: readonly string[]
  signals: readonly Signal[]
  ticksColor: Color
}

const SPACE = ' '
const LEGEND_MARKER = '⢕'
const Y_FREQUENCY = 7

/** `ut.linspace` */
export function linspace(lower: number, upper: number, length: number): number[] {
  const slope = length > 1 ? (upper - lower) / (length - 1) : 0

  return Array.from({ length }, (_, i) => lower + i * slope)
}

/** `ut.get_matrix_data`: data to canvas coordinates. */
export function matrixData(data: readonly number[], lim: readonly [number, number], bins: number): number[] {
  return data.map(el => Math.floor(plotextRound(0.5 + ((bins - 1) * (el - lim[0])) / (lim[1] - lim[0]), 8)))
}

function distinguishingDigitPair(a: number, b: number): number {
  let d = Math.abs(a - b)
  d = d === 0 ? 0 : -Math.log10(2 * d)
  d = d < 0 ? 0 : Math.ceil(d)

  return plotextRound(a, d) === plotextRound(b, d) ? d + 1 : d
}

/** `ut.get_labels`: the shortest labels that tell the ticks apart. */
export function getLabels(ticks: readonly number[]): string[] {
  const pairs = ticks.slice(0, -1).map((t, i) => distinguishingDigitPair(t, ticks[i + 1] ?? t))
  const d = pairs.length === 0 ? 1 : Math.max(...pairs)
  const allIntegers = ticks.every(el => el === Math.trunc(el))

  if (allIntegers) {
    return ticks.map(el => String(Math.trunc(el)))
  }

  const labels = ticks.map(el => {
    const text = toFixed(el, d + 1)

    return text.slice(0, text.indexOf('.') + d + 2)
  })

  if (labels.length <= 1) {
    return labels
  }

  return labels.map(label => {
    const zeros = label.length - 1 - label.indexOf(label.includes('e') ? 'e' : '.')

    return zeros < d ? label + '0'.repeat(d - zeros) : label
  })
}

/** `ut.get_line`: integer points from one coordinate pair to the next. */
function line(x0: number, x1: number, y0: number, y1: number): [number[], number[]] {
  const dx = Math.trunc(x1) - Math.trunc(x0)
  const dy = Math.trunc(y1) - Math.trunc(y0)
  const a = Math.trunc(Math.max(Math.abs(dx), Math.abs(dy)) + 1)

  return [linspace(x0, x1, a).map(Math.trunc), linspace(y0, y1, a).map(Math.trunc)]
}

/** `ut.get_lines` */
function lines(x: readonly number[], y: readonly number[]): [number[], number[]] {
  const xl: number[] = []
  const yl: number[] = []

  for (let n = 0; n < x.length - 1; n += 1) {
    const [xn, yn] = line(x[n] ?? 0, x[n + 1] ?? 0, y[n] ?? 0, y[n + 1] ?? 0)
    xl.push(...xn.slice(0, -1))
    yl.push(...yn.slice(0, -1))
  }

  if (x.length > 0) {
    xl.push(x[x.length - 1] ?? 0)
    yl.push(y[y.length - 1] ?? 0)
  }

  return [xl, yl]
}

/** `ut.fill_data` with a numeric level. */
function fill(x: readonly number[], y: readonly number[], level: number): [number[], number[]] {
  const xf: number[] = []
  const yf: number[] = []
  const seen = new Set<string>()

  for (let i = 0; i < x.length; i += 1) {
    const xi = x[i] ?? 0
    const yi = y[i] ?? 0
    const key = `${xi},${yi}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)

    const from = level < yi ? level : level > yi ? yi : level
    const to = level < yi ? yi + 1 : level > yi ? level : level + 1

    for (let v = from; v < to; v += 1) {
      xf.push(xi)
      yf.push(v)
    }
  }

  return [xf, yf]
}

/** `ut.brush`, keeping first-seen order (order never matters within one signal). */
function unique(x: readonly number[], y: readonly number[]): [number[], number[]] {
  const xs: number[] = []
  const ys: number[] = []
  const seen = new Set<string>()

  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    const key = `${x[i]},${y[i]}`

    if (!seen.has(key)) {
      seen.add(key)
      xs.push(x[i] ?? 0)
      ys.push(y[i] ?? 0)
    }
  }

  return [xs, ys]
}

/** Braille dot bits for sub-pixel (column 0–1, row 0–3 from the bottom). */
const BRAILLE_BIT: readonly (readonly [number, number])[] = [
  [0x40, 0x80],
  [0x04, 0x20],
  [0x02, 0x10],
  [0x01, 0x08],
]

/** `ut.hd_group` + `get_hd_marker` for braille: cells and their glyphs. */
function brailleCells(x: readonly number[], y: readonly number[]): { cx: number; cy: number; glyph: string }[] {
  const bits = new Map<string, { cx: number; cy: number; bits: number }>()

  for (let i = 0; i < x.length; i += 1) {
    const xi = x[i] ?? 0
    const yi = y[i] ?? 0
    const cx = floorDiv(xi, 2)
    const cy = floorDiv(yi, 4)
    const key = `${cx},${cy}`
    const cell = bits.get(key) ?? { cx, cy, bits: 0 }
    cell.bits |= BRAILLE_BIT[mod(yi, 4)]?.[mod(xi, 2)] ?? 0
    bits.set(key, cell)
  }

  return [...bits.values()].map(cell => ({
    cx: cell.cx,
    cy: cell.cy,
    glyph: cell.bits === 0 ? SPACE : String.fromCharCode(0x2800 + cell.bits),
  }))
}

/** `ut.correct_coord`: slides a label's start so it stays inside free space. */
function correctCoord(row: readonly Cell[], label: string, coord: number): number {
  const l = label.length
  let b = Math.max(coord - l + 1, 0)
  let e = Math.min(coord + l, row.length - 1)
  const free: number[] = []

  for (let i = b; i < e; i += 1) {
    if (row[i]?.glyph === SPACE) {
      free.push(i)
    }
  }

  const lo = free.length === 0 ? coord - l + 1 : Math.min(...free)
  const hi = free.length === 0 ? coord + l : Math.max(...free)
  b = hi - l + 1
  e = lo + l

  return floorDiv(b + e - l, 2)
}

type Alignment = 'left' | 'dynamic'

/** The plotext matrix: row 0 is the bottom row, as in `_matrix.py`. */
class Matrix {
  readonly cells: Cell[][]

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ glyph: SPACE, fg: null })))
  }

  private legal(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows
  }

  insert(col: number, row: number, glyph: string, fg: Color): void {
    if (this.legal(col, row)) {
      this.cells[row]![col] = { glyph, fg }
    }
  }

  horizontal(col: number, row: number, text: string, fg: Color, alignment: Alignment = 'left', checkSpace = false): boolean {
    const l = text.length
    const start = alignment === 'left' ? col : correctCoord(this.cells[row] ?? [], text, col)

    if (checkSpace) {
      const b = Math.max(start - 1, 0)
      const e = Math.min(start + l + 1, this.cols)

      for (let c = b; c < e; c += 1) {
        if (this.cells[row]?.[c]?.glyph !== SPACE) {
          return false
        }
      }

      if (start < 0 || start + l > this.cols) {
        return false
      }
    }

    for (let i = 0; i < l; i += 1) {
      this.insert(start + i, row, text[i] ?? SPACE, fg)
    }

    return true
  }

  vertical(col: number, row: number, text: string, fg: Color): void {
    for (let i = 0; i < text.length; i += 1) {
      this.insert(col, row + i, text[i] ?? SPACE, fg)
    }
  }

  /** Rows top-down, as the terminal shows them. */
  topDown(): Cell[][] {
    return [...this.cells].reverse()
  }
}

/** `build_plot`, for the figure ccburn's chart builds. Returns rows top-down. */
export function build(figure: Figure): Cell[][] {
  const { width, height, xlim, ylim, ticksColor } = figure
  const signals = figure.signals
  const sideUsed = { left: signals.some(s => (s.yside ?? 'left') === 'left'), right: signals.some(s => s.yside === 'right') }

  const yticks = linspace(ylim[0], ylim[1], Y_FREQUENCY)
  const yLabelsRaw = getLabels(yticks)
  const yWidth = Math.max(0, ...yLabelsRaw.map(l => l.length))
  const leftLabels = sideUsed.left ? yLabelsRaw.map(l => SPACE.repeat(yWidth - l.length) + l) : []
  const rightLabels = sideUsed.right ? yLabelsRaw.map(l => l + SPACE.repeat(yWidth - l.length)) : []
  const wl = [sideUsed.left ? yWidth : 0, sideUsed.right ? yWidth : 0] as const

  const ticks = figure.xticks
    .map((pos, i) => ({ pos, label: figure.xlabels[i] ?? '' }))
    .filter((t, i, all) => all.findIndex(o => o.pos === t.pos && o.label === t.label) === i)
    .sort((a, b) => a.pos - b.pos)
  const xLabelRows = ticks.length > 0 ? 1 : 0

  const widthCanvas = width - 2 - wl[0] - wl[1]
  const heightCanvas = height - 2 - xLabelRows
  const colStart = wl[0] + 1
  const colEnd = colStart + widthCanvas
  const rowStart = xLabelRows + 1
  const rowEnd = rowStart + heightCanvas

  const cticks = matrixData(
    ticks.map(t => t.pos),
    xlim,
    widthCanvas,
  )
  const rticks = matrixData(yticks, ylim, heightCanvas)
  const matrix = new Matrix(width, height)

  // Lower x tick labels, each kept only if it fits.
  const kept: number[] = []
  ticks.forEach((tick, i) => {
    const c = cticks[i] ?? 0
    if (height > 0 && matrix.horizontal(colStart + c, rowStart - 2, tick.label, ticksColor, 'dynamic', true)) {
      kept.push(c)
    }
  })

  // Upper x axis.
  if (heightCanvas >= -1) {
    matrix.horizontal(colStart, rowEnd, '─'.repeat(Math.max(0, widthCanvas)), ticksColor)
  }

  // Left y labels and axis.
  if (width >= wl[0]) {
    rticks.forEach((r, i) => matrix.horizontal(0, r + rowStart, leftLabels[i] ?? '', ticksColor))
  }

  const leftAxis = Array.from({ length: Math.max(0, heightCanvas) }, (_, i) => (rticks.includes(i) ? '┤' : '│')).join('')
  if (width >= wl[0] + wl[1] + 1) {
    matrix.vertical(wl[0], rowStart, leftAxis, ticksColor)
  }

  const rightAxis = Array.from({ length: Math.max(0, heightCanvas) }, (_, i) => (rticks.includes(i) && sideUsed.right ? '├' : '│')).join('')
  if (width >= wl[0] + wl[1] + 2) {
    matrix.vertical(colEnd, rowStart, rightAxis, ticksColor)
  }

  if (width >= wl[0] + wl[1] + 1) {
    rticks.forEach((r, i) => {
      if (rightLabels[i] !== undefined) {
        matrix.horizontal(colEnd + 1, r + rowStart, rightLabels[i], ticksColor)
      }
    })
  }

  // Corners.
  if (heightCanvas >= 0 && widthCanvas >= 0) {
    matrix.insert(colStart - 1, rowStart - 1, '└', ticksColor)
    matrix.insert(colEnd, rowStart - 1, '┘', ticksColor)
    matrix.insert(colStart - 1, rowEnd, '┌', ticksColor)
    matrix.insert(colEnd, rowEnd, '┐', ticksColor)
  }

  // Lower x axis, with a tick under every label that was kept.
  if (heightCanvas >= -1) {
    const axis = Array.from({ length: Math.max(0, widthCanvas) }, (_, i) => (kept.includes(i) ? '┬' : '─')).join('')
    matrix.horizontal(colStart, rowStart - 1, axis, ticksColor)
  }

  // Data, one signal at a time; a later signal replaces whole cells.
  const drawnColors: Color[] = []
  for (const signal of signals) {
    const isBraille = signal.marker === 'braille'
    const xf = isBraille ? 2 : 1
    const yf = isBraille ? 4 : 1
    const widthExpanded = widthCanvas * xf
    const heightExpanded = heightCanvas * yf
    const ylimSignal = ylim

    let x = widthExpanded !== 0 ? matrixData(signal.x, xlim, widthExpanded) : []
    let y = widthExpanded !== 0 ? matrixData(signal.y, ylimSignal, heightExpanded) : []
    ;[x, y] = lines(x, y)

    if (signal.fillx) {
      // `check_fill` turns `fillx=True` into a fill level of 0, clamped to the y range.
      const value = Math.min(Math.max(0, ylimSignal[0]), ylimSignal[1])
      const level = matrixData([value], ylimSignal, heightExpanded)[0] ?? 0
      ;[x, y] = fill(x, y, level)
    }

    ;[x, y] = unique(x, y)
    const cells = isBraille
      ? brailleCells(x, y)
      : x.map((cx, i) => ({ cx, cy: y[i] ?? 0, glyph: signal.marker }))

    let drew = false
    for (const cell of cells) {
      if (cell.cx >= 0 && cell.cx < widthCanvas && cell.cy >= 0 && cell.cy < heightCanvas) {
        matrix.insert(cell.cx + colStart, cell.cy + rowStart, cell.glyph, signal.color)
        drew = true
      }
    }
    drawnColors.push(drew ? signal.color : null)
  }

  // Legend, top-left of the canvas, one row per labelled signal.
  const labelled = signals.map((s, i) => ({ s, i })).filter(({ s }) => s.label !== undefined && s.label.trim() !== '')
  const labels = labelled.map(({ s }) => ` ${(s.label ?? '').trim()} `)
  const longest = Math.max(0, ...labels.map(l => l.length))
  const padded = labels.map(l => l + SPACE.repeat(longest - l.length))
  const isLegendShown = widthCanvas >= 3 + longest && heightCanvas >= labels.length

  if (isLegendShown) {
    labelled.forEach(({ s, i }, n) => {
      const row = rowEnd - 1 - n
      const marker = s.marker === 'braille' ? LEGEND_MARKER : s.marker
      matrix.insert(colStart, row, SPACE, null)
      matrix.insert(colStart + 1, row, marker, drawnColors[i] ?? s.color)
      matrix.insert(colStart + 2, row, marker, drawnColors[i] ?? s.color)
    })
    padded.forEach((label, n) => matrix.horizontal(colStart + 3, rowEnd - 1 - n, label, ticksColor))
  }

  return matrix.topDown()
}
