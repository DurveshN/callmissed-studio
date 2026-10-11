import type { JobInput, JobResult } from '@shared/ml/jobs'
import type { ModelPack } from '@shared/ml/models'
import { throwIfCancelled } from '../job-queue'
import type { SessionPool } from '../session-pool'

/** Loads every ONNX graph in a model pack and reports what it exposes and where it runs. */
export async function probe(
  input: JobInput<'probe'>,
  ctx: { pool: SessionPool; packs: ModelPack[]; signal: AbortSignal }
): Promise<JobResult<'probe'>> {
  const pack = ctx.packs.find((p) => p.id === input.model)
  if (!pack) throw new Error(`Unknown model ${input.model}`)
  const started = performance.now()
  const sessions: JobResult<'probe'>['sessions'] = []
  let provider: 'dml' | 'cpu' = 'dml'
  for (const file of pack.files.filter((f) => f.name.endsWith('.onnx'))) {
    throwIfCancelled(ctx.signal)
    const loaded = await ctx.pool.get(pack.id, file.name)
    if (loaded.provider === 'cpu') provider = 'cpu'
    sessions.push({
      file: file.name,
      inputs: [...loaded.session.inputNames],
      outputs: [...loaded.session.outputNames]
    })
  }
  return { model: pack.id, provider, loadMs: Math.round(performance.now() - started), sessions }
}
