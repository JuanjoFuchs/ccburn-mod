/** Ports of ccburn's `utils/formatting.py`. */

import { clockHour, clockTime, localTime, monthDay, type OffsetAt } from './clock'
import { floorDiv, int, toFixed } from './py'

/** `format_duration`: whole minutes as `45m`, `2h 14m`, `3d 5h`. */
export function formatDuration(minutes: number): string {
  if (minutes < 0) {
    return '0m'
  }

  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = floorDiv(minutes, 60)
  const mins = minutes % 60

  if (hours < 24) {
    return mins ? `${hours}h ${mins}m` : `${hours}h`
  }

  const days = floorDiv(hours, 24)
  const remainingHours = hours % 24

  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`
}

/** `format_percentage`: a 0–1 value as `62%` or `62.5%`. */
export function formatPercentage(value: number, decimalPlaces = 0): string {
  return `${toFixed(value * 100, decimalPlaces)}%`
}

/** `format_reset_time`: `Resets in 2h 14m`, `Resets Tue 4:00 PM`, `Resets Tue 10/7 7PM`. */
export function formatResetTime(resetsAt: number, now: number, offsetAt: OffsetAt): string {
  const totalMinutes = int((resetsAt - now) / 1000 / 60)

  if (totalMinutes < 0) {
    return 'Reset pending'
  }

  if (totalMinutes < 24 * 60) {
    return `Resets in ${formatDuration(totalMinutes)}`
  }

  const local = localTime(resetsAt, offsetAt)

  if (totalMinutes >= 7 * 24 * 60) {
    const time = local.minute === 0 ? clockHour(local) : clockTime(local)

    return `Resets ${local.weekday} ${monthDay(local)} ${time}`
  }

  return `Resets ${local.weekday} ${clockTime(local)}`
}

/** The colour names `get_utilization_color` answers. */
export type UtilizationColor = 'green' | 'yellow' | 'bright_red' | 'red'

/** `get_utilization_color`: threshold and burn ratio together. */
export function utilizationColor(utilization: number, budgetPace = 0): UtilizationColor {
  if (utilization >= 0.9) {
    return 'red'
  }

  let burnRatio = 1
  if (budgetPace >= 0.05 && utilization >= 0.01) {
    burnRatio = utilization / budgetPace
  }

  if (utilization >= 0.75) {
    return burnRatio > 1.5 ? 'red' : 'bright_red'
  }

  if (utilization >= 0.5) {
    if (burnRatio > 2) {
      return 'red'
    }

    return burnRatio > 1.5 ? 'bright_red' : 'yellow'
  }

  if (burnRatio > 3) {
    return 'bright_red'
  }

  return burnRatio > 2 ? 'yellow' : 'green'
}
