import type { AppEvent, Channel } from './channels'
import type { EventPayload, Request, Response } from './contracts'
import type { IpcResult } from './result'
import type { JobKind, MlOutcome } from '../ml/protocol'

/** Shape of `window.studio`, implemented by the preload script. */
export interface StudioApi {
  invoke<C extends Channel>(channel: C, input?: Request<C>): Promise<IpcResult<Response<C>>>
  /** Subscribes to a main → renderer event; returns an unsubscribe function. */
  on<E extends AppEvent>(event: E, listener: (payload: EventPayload<E>) => void): () => void
  /** Absolute path of a file dropped onto the window. */
  pathForFile(file: File): string
  /** Runs a job on the local ML worker. */
  ml: {
    run(
      kind: JobKind,
      input: unknown,
      onProgress?: (progress: number) => void
    ): { result: Promise<MlOutcome>; cancel(): void }
  }
}
