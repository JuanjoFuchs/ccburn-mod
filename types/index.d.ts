/** One rate-limit reading, as stored. `percentUsed` is 0–100; times are epoch milliseconds. */
export type Reading = {
  provider: string
  kind: string
  timestamp: number
  percentUsed: number
  resetsAt: number
}

/** The two windows the pane can draw. */
export type WindowKind = 'five_hour' | 'seven_day'

declare module 'claude-code' {
  interface PluginState {
    ccburn: {
      /** The window the pane shows. */
      window: WindowKind
      /** Every stored reading, oldest first. */
      readings: Reading[]
      /** The clock the chart was last drawn against, so a timer tick redraws it. */
      now: number
      /** True once the account has answered with no rate-limit windows at all. */
      isWithoutLimits: boolean
    }
  }
}
