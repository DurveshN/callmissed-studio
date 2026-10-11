import type { Channel, Request, Response } from '@shared/ipc/contracts'
import { StudioError } from '@shared/ipc/result'

/** Calls the main process and unwraps the result envelope, throwing StudioError on failure. */
export async function call<C extends Channel>(channel: C, input?: Request<C>): Promise<Response<C>> {
  const result = await window.studio.invoke(channel, input)
  if (!result.ok) throw new StudioError(result.error.code, result.error.message)
  return result.data
}
