/**
 * ML worker entry, run by Electron's utilityProcess. Receives control messages from main on
 * process.parentPort and jobs from the renderer on a dedicated MessagePort.
 */
import { InferenceSession } from 'onnxruntime-node'
import { jobs } from '@shared/ml/jobs'
import type { ModelPack } from '@shared/ml/models'
import type {
  FromWorker,
  JobRequest,
  MlErrorCode,
  ToWorker,
  WorkerControl,
  WorkerNotice
} from '@shared/ml/protocol'
import { probe } from './handlers/probe'
import { CancelledError, JobQueue } from './job-queue'
import { ModelLoadError, ModelMissingError, SessionPool } from './session-pool'

interface Port {
  postMessage(message: FromWorker, transfer?: unknown[]): void
  on(event: 'message', listener: (e: { data: ToWorker }) => void): void
  on(event: 'close', listener: () => void): void
  start(): void
}

const parent = process.parentPort
const notify = (notice: WorkerNotice) => parent.postMessage(notice)

const pool = new SessionPool(
  (path, options) => InferenceSession.create(path, options),
  (message) => notify({ type: 'gpu-failed', message })
)
const queue = new JobQueue()
let packs: ModelPack[] = []

function classify(error: unknown): { code: MlErrorCode; message: string } {
  if (error instanceof CancelledError) return { code: 'CANCELLED', message: 'Cancelled' }
  if (error instanceof ModelMissingError) {
    return { code: 'MODEL_MISSING', message: 'This feature needs a model that is not installed.' }
  }
  if (error instanceof ModelLoadError) return { code: 'MODEL_LOAD_FAILED', message: error.message }
  const message = error instanceof Error ? error.message : String(error)
  return { code: 'INTERNAL', message }
}

async function execute(job: JobRequest, signal: AbortSignal, reply: (m: FromWorker) => void): Promise<void> {
  try {
    if (signal.aborted) throw new CancelledError()
    const spec = jobs[job.kind]
    const input = spec.input.safeParse(job.input)
    if (!input.success) {
      reply({ type: 'error', id: job.id, code: 'INVALID_JOB', message: input.error.message })
      return
    }
    const ctx = {
      pool,
      packs,
      signal,
      progress: (p: number) => reply({ type: 'progress', id: job.id, progress: p })
    }
    let result: unknown
    switch (job.kind) {
      case 'probe':
        result = await probe(input.data, ctx)
        break
    }
    reply({ type: 'result', id: job.id, result })
  } catch (error) {
    reply({ type: 'error', id: job.id, ...classify(error) })
  }
}

function attach(port: Port): void {
  const reply = (m: FromWorker) => port.postMessage(m)
  port.on('message', ({ data }) => {
    if (data?.type === 'run' && typeof data.id === 'number' && Object.hasOwn(jobs, data.kind)) {
      queue.enqueue(data.id, (signal) => execute(data, signal, reply))
    } else if (data?.type === 'cancel' && typeof data.id === 'number') {
      queue.cancel(data.id)
    } else if (data && typeof (data as { id?: unknown }).id === 'number') {
      reply({ type: 'error', id: (data as { id: number }).id, code: 'INVALID_JOB', message: 'Unknown job' })
    }
  })
  port.start()
}

parent.on('message', (event: { data: WorkerControl; ports: Port[] }) => {
  const msg = event.data
  if (msg.type === 'configure') {
    packs = msg.packs
    pool.configure(msg.modelsDir, msg.gpu)
  } else if (msg.type === 'connect') {
    const port = event.ports[0]
    if (port) attach(port)
  } else if (msg.type === 'release-models') {
    void pool.release(msg.ids).then(() => notify({ type: 'released', requestId: msg.requestId }))
  }
})

notify({ type: 'ready' })
