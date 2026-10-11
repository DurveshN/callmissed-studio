import { readFile } from 'node:fs/promises'
import type { JobInput, JobResult } from '@shared/ml/jobs'
import { throwIfCancelled } from '../job-queue'
import { parseCharacterDict } from '../pipelines/ocr/dict'
import { runOcr } from '../pipelines/ocr/ocr'
import type { HandlerContext } from './context'

let dictionary: { path: string; dict: string[] } | null = null

async function loadDict(path: string): Promise<string[]> {
  if (dictionary?.path !== path) dictionary = { path, dict: parseCharacterDict(await readFile(path, 'utf8')) }
  return dictionary.dict
}

export async function ocr(input: JobInput<'ocr'>, ctx: HandlerContext): Promise<JobResult<'ocr'>> {
  const [det, rec, dict] = await Promise.all([
    ctx.pool.get('ocr', 'det.onnx'),
    ctx.pool.get('ocr', 'rec.onnx'),
    loadDict(ctx.pool.filePath('ocr', 'rec.yml'))
  ])
  throwIfCancelled(ctx.signal)
  const lines = await runOcr(
    { width: input.width, height: input.height, data: input.pixels },
    { det: det.session, rec: rec.session, dict },
    { progress: ctx.progress, checkCancelled: () => throwIfCancelled(ctx.signal) }
  )
  return {
    lines: lines.map((l) => ({
      ...l,
      mask: { width: l.mask.width, height: l.mask.height, data: l.mask.data }
    })),
    provider: det.provider
  }
}
