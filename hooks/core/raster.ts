/**
 * Packing for the terminal's `Raster` element: `columns * rows` cells, each
 * three little-endian u32s `[codePoint, foreground, background]`, as
 * standard padded base64. Encoded by hand so it depends on no runtime
 * encoder.
 */

import type { Cell } from './plotext'

/** The terminal's own default colour, as `RasterProps` spells it. */
export const DEFAULT_COLOR = 0x01000000

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64(bytes: Uint8Array): string {
  let out = ''
  let i = 0

  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!
  }

  const rest = bytes.length - i
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + '=='
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8)
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '='
  }

  return out
}

/** Packs rows of cells (all the same length) for a `Raster`'s `cells` prop. */
export function packCells(rows: readonly (readonly Cell[])[]): { cells: string; columns: number; rows: number } {
  const columns = rows[0]?.length ?? 0
  const words = new Uint32Array(columns * rows.length * 3)
  let w = 0

  for (const row of rows) {
    for (const cell of row) {
      words[w] = cell.glyph.codePointAt(0) ?? 0x20
      words[w + 1] = cell.fg ?? DEFAULT_COLOR
      words[w + 2] = DEFAULT_COLOR
      w += 3
    }
  }

  const bytes = new Uint8Array(words.length * 4)
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? 0
    bytes[i * 4] = word & 0xff
    bytes[i * 4 + 1] = (word >>> 8) & 0xff
    bytes[i * 4 + 2] = (word >>> 16) & 0xff
    bytes[i * 4 + 3] = (word >>> 24) & 0xff
  }

  return { cells: base64(bytes), columns, rows: rows.length }
}
