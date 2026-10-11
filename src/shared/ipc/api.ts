import type { Channel } from './channels'
import type { Request, Response } from './contracts'
import type { IpcResult } from './result'

/** Shape of `window.studio`, implemented by the preload script. */
export interface StudioApi {
  invoke<C extends Channel>(channel: C, input?: Request<C>): Promise<IpcResult<Response<C>>>
}
