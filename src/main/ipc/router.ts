import { BrowserWindow, ipcMain } from 'electron'
import { contracts, type Channel, type Request, type Response } from '@shared/ipc/contracts'
import { fail, ok, StudioError, type IpcResult } from '@shared/ipc/result'
import { isTrustedSender } from '../security'

export interface HandlerContext {
  /** Window whose renderer made the call. */
  window: BrowserWindow | null
}

type HandlerResult<T> = [T] extends [undefined] ? void | Promise<void> : T | Promise<T>

export type Handler<C extends Channel> = (
  input: Request<C>,
  context: HandlerContext
) => HandlerResult<Response<C>>

/** Registers a handler whose input/output are validated against the channel contract. */
export function handle<C extends Channel>(channel: C, handler: Handler<C>): void {
  const contract = contracts[channel]
  ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<Response<C>>> => {
    if (!isTrustedSender(event.senderFrame)) return fail('UNTRUSTED_SENDER', 'Untrusted sender')
    const input = contract.request.safeParse(raw)
    if (!input.success) return fail('INVALID_INPUT', input.error.message)
    try {
      const output = await handler(input.data as Request<C>, {
        window: BrowserWindow.fromWebContents(event.sender)
      })
      return ok(contract.response.parse(output) as Response<C>)
    } catch (error) {
      if (error instanceof StudioError) return fail(error.code, error.message)
      console.error(`[ipc] ${channel} failed`, error)
      return fail('INTERNAL', 'Unexpected error')
    }
  })
}
