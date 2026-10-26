/** Every renderer → main channel. Kept free of runtime deps so the preload bundle stays tiny. */
export const CHANNELS = [
  'app:get-info',
  'file:pick-open',
  'file:pick-image',
  'file:pick-pages',
  'workspace:open-path',
  'workspace:import-image',
  'workspace:import-pages',
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
  'export:choose-pdf-path',
  'export:write-pdf',
  'window:set-dirty',
  'window:close-confirmed',
  'window:renderer-ready',
  'models:list',
  'models:download',
  'models:cancel',
  'models:remove',
  'settings:get',
  'settings:update',
  'ai:key-status',
  'ai:set-key',
  'ai:remove-key',
  'ai:test-key',
  'ai:models',
  'ai:generate',
  'ai:cancel',
  'ai:usage',
  'ai:history',
  'ai:import'
] as const

export type Channel = (typeof CHANNELS)[number]

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value)
}

/** Main → renderer push events. */
export const EVENTS = [
  'app:save-and-close',
  'app:open-path',
  'models:changed',
  'settings:changed',
  'ml:gpu-failed'
] as const
export type AppEvent = (typeof EVENTS)[number]

export function isAppEvent(value: unknown): value is AppEvent {
  return typeof value === 'string' && (EVENTS as readonly string[]).includes(value)
}
