import { ipcRenderer } from 'electron'
import type { FromWorker, JobKind, MlErrorCode, MlOutcome, ToWorker } from '@shared/ml/protocol'

const PORT_WAIT_MS = 15_000

interface Pending {
  resolve(outcome: MlOutcome): void
  onProgress?: (progress: number) => void
}

let port: MessagePort | null = null
let nextId = 1
const pending = new Map<number, Pending>()
const waiters = new Set<() => void>()

function failAll(code: MlErrorCode, message: string): void {
  for (const p of pending.values()) p.resolve({ ok: false, code, message })
  pending.clear()
}

function onMessage(event: MessageEvent<FromWorker>): void {
  const msg = event.data
  const entry = pending.get(msg.id)
  if (!entry) return
  if (msg.type === 'progress') return entry.onProgress?.(msg.progress)
  pending.delete(msg.id)
  entry.resolve(
    msg.type === 'result'
      ? { ok: true, result: msg.result }
      : { ok: false, code: msg.code, message: msg.message }
  )
}

ipcRenderer.on('ml:port', (event) => {
  failAll('WORKER_RESTARTED', 'The AI engine restarted. Please try again.')
  port?.close()
  port = event.ports[0] ?? null
  if (!port) return
  port.onmessage = onMessage
  for (const wake of waiters) wake()
  waiters.clear()
})

ipcRenderer.on('ml:down', () => {
  failAll('WORKER_RESTARTED', 'The AI engine stopped unexpectedly and is restarting. Please try again.')
  port = null
})

function waitForPort(): Promise<MessagePort | null> {
  if (port) return Promise.resolve(port)
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer)
      resolve(port)
    }
    const timer = setTimeout(() => {
      waiters.delete(wake)
      resolve(null)
    }, PORT_WAIT_MS)
    waiters.add(wake)
  })
}

/** ArrayBuffers in the top level of the input (directly or behind typed arrays) are transferred, not copied. */
function transferables(input: unknown): ArrayBuffer[] {
  if (!input || typeof input !== 'object') return []
  const out = new Set<ArrayBuffer>()
  for (const value of Object.values(input)) {
    if (value instanceof ArrayBuffer) out.add(value)
    else if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) out.add(value.buffer)
  }
  return [...out]
}

export const mlBridge = {
  run(kind: JobKind, input: unknown, onProgress?: (progress: number) => void) {
    const id = nextId++
    const result = new Promise<MlOutcome>((resolve) => {
      pending.set(id, { resolve, ...(onProgress ? { onProgress } : {}) })
      void waitForPort().then((p) => {
        if (!pending.has(id)) return
        if (!p) {
          pending.delete(id)
          resolve({ ok: false, code: 'WORKER_UNAVAILABLE', message: 'The AI engine is not available.' })
          return
        }
        p.postMessage({ type: 'run', id, kind, input } satisfies ToWorker, transferables(input))
      })
    })
    return {
      result,
      cancel: () => port?.postMessage({ type: 'cancel', id } satisfies ToWorker)
    }
  }
}
