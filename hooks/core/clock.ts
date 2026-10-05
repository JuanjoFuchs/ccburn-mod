/**
 * Local-time formatting as ccburn's `strftime` calls produce it. Every
 * function takes the UTC offset in minutes, so a test pins the time zone and
 * the mod passes the machine's.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Minutes east of UTC at `ms`, for the machine the mod runs on. */
export type OffsetAt = (ms: number) => number

/** The machine's own offset, as Python's `astimezone()` would apply it. */
export const machineOffset: OffsetAt = ms => -new Date(ms).getTimezoneOffset()

export type LocalTime = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: string
}

export function localTime(ms: number, offsetAt: OffsetAt): LocalTime {
  const shifted = new Date(ms + offsetAt(ms) * 60_000)

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: DAYS[shifted.getUTCDay()] ?? 'Sun',
  }
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** `%H:%M` */
export const hourMinute = (t: LocalTime): string => `${pad2(t.hour)}:${pad2(t.minute)}`

/** `%a %Hh` */
export const dayHour = (t: LocalTime): string => `${t.weekday} ${pad2(t.hour)}h`

/** `{month}/{day}` */
export const monthDay = (t: LocalTime): string => `${t.month}/${t.day}`

/** `{month}/{day} {hour}h` */
export const monthDayHour = (t: LocalTime): string => `${t.month}/${t.day} ${t.hour}h`

const hour12 = (t: LocalTime): number => (t.hour % 12 === 0 ? 12 : t.hour % 12)
const meridiem = (t: LocalTime): string => (t.hour < 12 ? 'AM' : 'PM')

/** `strftime("%I:%M %p").lstrip("0")` */
export const clockTime = (t: LocalTime): string => `${hour12(t)}:${pad2(t.minute)} ${meridiem(t)}`

/** `strftime("%I%p").lstrip("0")` */
export const clockHour = (t: LocalTime): string => `${hour12(t)}${meridiem(t)}`

/**
 * ccburn's tick rounding: drop seconds, adding a minute when the seconds
 * were 30 or more. Returns the rounded instant in epoch milliseconds.
 */
export function roundToMinute(ms: number): number {
  const seconds = Math.floor((((ms % 60_000) + 60_000) % 60_000) / 1000)
  const floored = Math.floor(ms / 60_000) * 60_000

  return seconds >= 30 ? floored + 60_000 : floored
}
