import { z } from 'zod'
import type { Channel } from './channels'

export { CHANNELS, isChannel, type Channel } from './channels'

interface Contract {
  request: z.ZodType
  response: z.ZodType
}

/**
 * Request/response schemas per channel; both sides of the IPC boundary validate against these.
 * `satisfies` forces a contract for every channel in CHANNELS and no extras.
 */
export const contracts = {
  'app:get-info': {
    request: z.undefined(),
    response: z.object({
      name: z.string(),
      version: z.string(),
      electron: z.string(),
      platform: z.string()
    })
  }
} as const satisfies Record<Channel, Contract>

export type Request<C extends Channel> = z.infer<(typeof contracts)[C]['request']>
export type Response<C extends Channel> = z.infer<(typeof contracts)[C]['response']>
