import type {
  FontMatchRequest,
  FontMatchResult,
  FontWorkerMessage,
  FontWorkerReply
} from './font-match-protocol'

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve(r: FontMatchResult | null): void; reject(e: Error): void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./font-match.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<FontWorkerReply>) => {
    const reply = event.data
    const entry = pending.get(reply.id)
    if (!entry) return
    pending.delete(reply.id)
    if ('error' in reply) entry.reject(new Error(reply.error))
    else entry.resolve(reply.result)
  }
  worker.postMessage({ type: 'init', baseUrl: document.baseURI } satisfies FontWorkerMessage)
  return worker
}

/** Finds the bundled or system font that best reproduces the ink of a text line (null if none fits). */
export function matchFont(request: FontMatchRequest): Promise<FontMatchResult | null> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ type: 'match', id, request } satisfies FontWorkerMessage)
  })
}
