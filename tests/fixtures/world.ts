import type { On, SessionRateLimit } from 'claude-code'

/** What the plugin asked of the engine, and the store it wrote to. */
export type World = {
  store: Map<string, unknown>
  opened: string[]
  /** The inline rows each open asked for. */
  openedRows: (number | undefined)[]
  commands: string[]
  /** What `$.session.usage()` answers; change it between calls. */
  rateLimits: SessionRateLimit[]
}

export const PLUGIN = 'ccburn'
export const NOW = Date.parse('2026-09-15T16:30:00Z')
export const RESETS = Date.parse('2026-09-15T19:00:00Z')
export const SESSION = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }

export const limits = (fiveHour: number, sevenDay = 20): SessionRateLimit[] => [
  { kind: 'five_hour', percentUsed: fiveHour, resetsAt: new Date(RESETS).toISOString() },
  { kind: 'seven_day', percentUsed: sevenDay, resetsAt: '2026-09-19T00:00:00.000Z' },
]

/** Seats the engine beneath the plugin: the ops it calls and the bottoms of the events it hooks. */
export function worldOf(on: On, store: Record<string, unknown> = {}): World {
  const world: World = { store: new Map(Object.entries(store)), opened: [], openedRows: [], commands: [], rateLimits: [] }

  on('store.get', ($, e) => ({ value: world.store.get(e.key) }))
  on('store.set', ($, e) => {
    world.store.set(e.key, JSON.parse(JSON.stringify(e.value)))

    return { value: undefined }
  })
  on('command.register', ($, e) => {
    world.commands.push(e.name)

    return { value: { command: e.name } }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: world.rateLimits } }))
  on('ui.open', ($, e) => {
    world.opened.push(e.id)
    world.openedRows.push(e.rows)

    return { value: { isPlaced: true } } as never
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', () => ({ type: 'Text', children: [''] }))

  return world
}

export const pane = (surface: 'terminal' | 'desktop', bodyColumns: number, bodyRows: number, placement: 'dock' | 'inline' = 'dock') => ({
  plugin: PLUGIN,
  component: 'Pane' as const,
  surface,
  requestId: 'ccburn',
  viewport: { columns: 200, rows: 60, isFullscreen: placement === 'dock' },
  props: { title: 'ccburn', isFocused: false, bodyColumns, placement, scroll: { offset: 0, bodyRows }, view: {} },
})

export const command = (args = '') => ({
  command: 'ccburn',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 200 },
})

export const measure = (rateLimits: SessionRateLimit[]) => ({
  context: { window: 200_000 },
  rateLimits,
  changed: ['rateLimits' as const],
})
