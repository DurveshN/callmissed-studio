export type ErrorCode =
  | 'INVALID_INPUT'
  | 'UNTRUSTED_SENDER'
  | 'UNKNOWN_CHANNEL'
  | 'INTERNAL'
  /** A CallMissed API request failed; the message says why and what to do. */
  | 'API'
  | 'CANCELLED'

export interface IpcError {
  code: ErrorCode
  message: string
}

/** Envelope every IPC handler returns, so error codes survive the process boundary. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

export class StudioError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'StudioError'
  }
}

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

export function fail(code: ErrorCode, message: string): IpcResult<never> {
  return { ok: false, error: { code, message } }
}
