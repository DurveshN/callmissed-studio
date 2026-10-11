/** Every renderer → main channel. Kept free of runtime deps so the preload bundle stays tiny. */
export const CHANNELS = [
  'app:get-info',
  'file:pick-open',
  'file:pick-image',
  'workspace:open-path',
  'workspace:import-image',
  'workspace:autosave',
  'workspace:close',
  'workspace:list-recoverable',
  'workspace:recover',
  'workspace:discard',
  'asset:read',
  'asset:write',
  'project:save',
  'library:recent',
  'library:forget',
  'export:save-image',
  'window:set-dirty',
  'window:close-confirmed'
] as const

export type Channel = (typeof CHANNELS)[number]

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value)
}

/** Main → renderer push events. */
export const EVENTS = ['app:save-and-close', 'app:open-path'] as const
export type AppEvent = (typeof EVENTS)[number]

export function isAppEvent(value: unknown): value is AppEvent {
  return typeof value === 'string' && (EVENTS as readonly string[]).includes(value)
}
