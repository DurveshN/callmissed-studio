import type { ModelPack } from '@shared/ml/models'
import type { SessionPool } from '../session-pool'

/** What every job handler receives from the worker. */
export interface HandlerContext {
  pool: SessionPool
  packs: ModelPack[]
  signal: AbortSignal
  progress(p: number): void
}
