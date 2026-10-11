import type { ModelPack } from './models'

/**
 * Messages between the renderer (via preload) and the ML worker over a MessagePort.
 * Kept free of runtime dependencies so the preload bundle stays small; the worker validates with jobs.ts.
 */

export type JobKind = 'probe' | 'ocr' | 'inpaint'

export interface JobRequest {
  type: 'run'
  id: number
  kind: JobKind
  input: unknown
}

export interface JobCancel {
  type: 'cancel'
  id: number
}

export type ToWorker = JobRequest | JobCancel

export type FromWorker =
  | { type: 'progress'; id: number; progress: number }
  | { type: 'result'; id: number; result: unknown }
  | { type: 'error'; id: number; code: MlErrorCode; message: string }

export type MlErrorCode =
  | 'INVALID_JOB'
  | 'MODEL_MISSING'
  | 'MODEL_LOAD_FAILED'
  | 'CANCELLED'
  | 'WORKER_RESTARTED'
  | 'WORKER_UNAVAILABLE'
  | 'INTERNAL'

/** Main → worker control messages (over process.parentPort). */
export type WorkerControl =
  | { type: 'configure'; modelsDir: string; gpu: GpuMode; packs: ModelPack[] }
  | { type: 'connect' }
  | { type: 'release-models'; ids: string[]; requestId: number }

/** Worker → main notifications. */
export type WorkerNotice =
  { type: 'ready' } | { type: 'gpu-failed'; message: string } | { type: 'released'; requestId: number }

/** Outcome of a job as seen by the page (errors are values so their codes survive the context bridge). */
export type MlOutcome = { ok: true; result: unknown } | { ok: false; code: MlErrorCode; message: string }

export type GpuMode = 'auto' | 'off'
