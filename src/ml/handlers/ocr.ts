import { readFile } from 'node:fs/promises'
import type { JobInput, JobResult } from '@shared/ml/jobs'
import { throwIfCancelled } from '../job-queue'
import { parseCharacterDict } from '../pipelines/ocr/dict'
import { runOcr, sessionInfer, type Infer } from '../pipelines/ocr/ocr'
import type { HandlerContext } from './context'

let dictionary: { path: string; dict: string[] } | null = null

async function loadDict(path: string): Promise<string[]> {
  if (dictionary?.path !== path) dictionary = { path, dict: parseCharacterDict(await readFile(path, 'utf8')) }
  return dictionary.dict
}

export async function ocr(input: JobInput<'ocr'>, ctx: HandlerContext): Promise<JobResult<'ocr'>> {
  const dict = await loadDict(ctx.pool.filePath('ocr', 'rec.yml'))
  let provider: 'dml' | 'cpu' = 'cpu'
  // Each model call goes through the pool so a DirectML failure falls back to CPU and retries.
  const infer =
    (file: string): Infer =>
    async (data, dims) => {
      const { result, provider: used } = await ctx.pool.run('ocr', file, (s) => sessionInfer(s)(data, dims))
      if (file === 'det.onnx') provider = used
      return result
    }
  throwIfCancelled(ctx.signal)
  const lines = await runOcr(
    { width: input.width, height: input.height, data: input.pixels },
    { det: infer('det.onnx'), rec: infer('rec.onnx'), dict },
    { progress: ctx.progress, checkCancelled: () => throwIfCancelled(ctx.signal) }
  )
  return {
    lines: lines.map((l) => ({
      ...l,
      mask: { width: l.mask.width, height: l.mask.height, data: l.mask.data }
    })),
    provider
  }
}
