/**
 * Python semantics the port depends on, so the mod and ccburn never disagree
 * by one on the same reading: fixed-point formatting with round-half-to-even
 * on exact ties, floor division, and plotext's own `round`.
 */

/** `f"{x:.{digits}f}"` — correctly rounded, exact ties to even. */
export function toFixed(x: number, digits: number): string {
  if (!Number.isFinite(x)) {
    return String(x)
  }

  const sign = x < 0 || Object.is(x, -0) ? '-' : ''
  const magnitude = Math.abs(x)
  const wide = magnitude.toFixed(Math.min(digits + 20, 100))
  const point = wide.indexOf('.')
  const tail = wide.slice(point + 1 + digits)
  const isTie = tail.length > 0 && tail[0] === '5' && /^50*$/.test(tail)
  let body: string

  if (isTie) {
    const kept = digits === 0 ? wide.slice(0, point) : wide.slice(0, point + 1 + digits)
    const last = Number(kept[kept.length - 1])
    body = last % 2 === 0 ? kept : magnitude.toFixed(digits)
  } else {
    body = magnitude.toFixed(digits)
  }

  return sign + body
}

/** Python's `a // b` for numbers. */
export const floorDiv = (a: number, b: number): number => Math.floor(a / b)

/** Python's `a % b` (the sign follows the divisor). */
export const mod = (a: number, b: number): number => ((a % b) + b) % b

/** plotext's `ut.round`: halves round up, unlike Python's builtin. */
export function plotextRound(n: number, digits = 0): number {
  const scaled = n * 10 ** digits
  const floor = Math.floor(scaled)
  const rounded = scaled - floor < 0.5 ? floor : Math.ceil(scaled)

  return rounded * 10 ** -digits
}

/** Python's `int(x)` for a float: truncates toward zero. */
export const int = (x: number): number => Math.trunc(x)
