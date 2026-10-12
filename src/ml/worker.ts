/**
 * ML worker entry, run by Electron's utilityProcess. Receives control messages from main on
 * process.parentPort and jobs from the renderer on a dedicated MessagePort.
 */
import { constants, setPriority } from 'node:os'
import { InferenceSession } from 'onnxruntime-node'
import { jobs, type JobInput } from '@shared/ml/jobs'
import type { ModelPack } from '@shared/ml/models'
import type {
  FromWorker,
  JobRequest,
  MlErrorCode,
  ToWorker,
  WorkerControl,
  WorkerNotice
} from '@shared/ml/protocol'
import { inpaint } from './handlers/inpaint'
import { ocr } from './handlers/ocr'
import { probe } from './handlers/probe'
import { removeBg } from './handlers/remove-bg'
import { NotPreparedError, segment, segmentPrepare } from './handlers/segment'
import { CancelledError, JobQueue } from './job-queue'
import { ModelLoadError, ModelMissingError, SessionPool } from './session-pool'

interface Port {
  postMessage(message: FromWorker): void
  on(event: 'message', listener: (e: { data: ToWorker }) => void): void
  on(event: 'close', listener: () => void): void
  start(): void
}

const parent = process.parentPort
const notify = (notice: WorkerNotice) => parent.postMessage(notice)

const pool = new SessionPool(
  (path, options) => InferenceSession.create(path, options),
  (message) => notify({ type: 'gpu-failed', message }),
  (file) => notify({ type: 'gpu-incompatible', file })
)
const queue = new JobQueue()
let packs: ModelPack[] = []

/** Files of packs marked `gpu: false` in the manifest (known to fail or gain nothing on DirectML). */
function cpuOnlyPackFiles(list: ModelPack[]): string[] {
  return list.filter((p) => p.gpu === false).flatMap((p) => p.files.map((f) => `${p.id}/${f.name}`))
}

function classify(error: unknown): { code: MlErrorCode; message: string } {
  if (error instanceof CancelledError) return { code: 'CANCELLED', message: 'Cancelled' }
  if (error instanceof ModelMissingError) {
    return { code: 'MODEL_MISSING', message: 'This feature needs a model that is not installed.' }
  }
  if (error instanceof ModelLoadError) return { code: 'MODEL_LOAD_FAILED', message: error.message }
  if (error instanceof NotPreparedError) return { code: 'NOT_PREPARED', message: error.message }
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
        result = await probe(input.data as JobInput<'probe'>, ctx)
        break
      case 'ocr':
        result = await ocr(input.data as JobInput<'ocr'>, ctx)
        break
      case 'inpaint':
        result = await inpaint(input.data as JobInput<'inpaint'>, ctx)
        break
      case 'segment-prepare':
        result = await segmentPrepare(input.data as JobInput<'segment-prepare'>, ctx)
        break
      case 'segment':
        result = await segment(input.data as JobInput<'segment'>, ctx)
        break
      case 'remove-bg':
        result = await removeBg(input.data as JobInput<'remove-bg'>, ctx)
        break
    }
    reply({ type: 'result', id: job.id, result })
  } catch (error) {
    reply({ type: 'error', id: job.id, ...classify(error) })
  }
}

function attach(port: Port): void {
  // MessagePortMain cannot transfer ArrayBuffers; results are copied by structured clone.
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
    void pool
      .configure(msg.modelsDir, msg.gpu, [...msg.cpuOnly, ...cpuOnlyPackFiles(msg.packs)])
      .then(() => notify({ type: 'ack', requestId: msg.requestId }))
  } else if (msg.type === 'connect') {
    const port = event.ports[0]
    if (port) attach(port)
  } else if (msg.type === 'release-models') {
    void pool.release(msg.ids).then(() => notify({ type: 'ack', requestId: msg.requestId }))
  }
})

// Chromium starts utility processes at background priority; on hybrid CPUs Windows then keeps them on
// efficiency cores, which made inference several times slower (LaMa: ~20 s instead of ~3.4 s).
try {
  setPriority(constants.priority.PRIORITY_NORMAL)
} catch (error) {
  console.warn('[ml] could not raise worker priority:', error)
}
notify({ type: 'ready' })
