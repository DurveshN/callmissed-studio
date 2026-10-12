import type { ModelPack } from './models'

/**
 * Messages between the renderer (via preload) and the ML worker over a MessagePort.
 * Kept free of runtime dependencies so the preload bundle stays small; the worker validates with jobs.ts.
 */

export type JobKind = 'probe' | 'ocr' | 'inpaint' | 'segment-prepare' | 'segment' | 'remove-bg'

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
  /** `segment` ran without `segment-prepare` for that image (or the worker restarted since). */
  | 'NOT_PREPARED'
  | 'WORKER_RESTARTED'
  | 'WORKER_UNAVAILABLE'
  | 'INTERNAL'

/** Main → worker control messages (over process.parentPort). */
export type WorkerControl =
  | {
      type: 'configure'
      modelsDir: string
      gpu: GpuMode
      /** Model files known to fail on this GPU; loaded on CPU directly. */
      cpuOnly: string[]
      packs: ModelPack[]
      requestId: number
    }
  | { type: 'connect' }
  | { type: 'release-models'; ids: string[]; requestId: number }

/** Worker → main notifications. */
export type WorkerNotice =
  | { type: 'ready' }
  | { type: 'gpu-failed'; message: string }
  /** A model file failed while running on the GPU and now runs on CPU. */
  | { type: 'gpu-incompatible'; file: string }
  /** Acknowledges a control message carrying `requestId` once it has fully taken effect. */
  | { type: 'ack'; requestId: number }

/** Outcome of a job as seen by the page (errors are values so their codes survive the context bridge). */
export type MlOutcome = { ok: true; result: unknown } | { ok: false; code: MlErrorCode; message: string }

export type GpuMode = 'auto' | 'off'
