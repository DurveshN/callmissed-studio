import { jobs, type JobInput, type JobResult } from '@shared/ml/jobs'
import type { JobKind, MlErrorCode } from '@shared/ml/protocol'
import { whenSettingsApplied } from '../models/models-store'

export class MlError extends Error {
  constructor(
    readonly code: MlErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'MlError'
  }
}

interface RunOptions {
  onProgress?: (progress: number) => void
  signal?: AbortSignal
}

/** Runs a job on the local ML worker; throws MlError on failure or cancellation. */
export async function runJob<K extends JobKind>(
  kind: K,
  input: JobInput<K>,
  { onProgress, signal }: RunOptions = {}
): Promise<JobResult<K>> {
  // A GPU mode switch in flight must reach the worker before this job does.
  await whenSettingsApplied()
  if (signal?.aborted) throw new MlError('CANCELLED', 'Cancelled')
  const job = window.studio.ml.run(kind, input, onProgress)
  const onAbort = () => job.cancel()
  signal?.addEventListener('abort', onAbort)
  try {
    const outcome = await job.result
    if (!outcome.ok) throw new MlError(outcome.code, outcome.message)
    return jobs[kind].result.parse(outcome.result) as JobResult<K>
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
