/** Every renderer → main channel. Kept free of runtime deps so the preload bundle stays tiny. */
export const CHANNELS = ['app:get-info'] as const

export type Channel = (typeof CHANNELS)[number]

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value)
}
