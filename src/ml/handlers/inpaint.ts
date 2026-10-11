import type { JobInput, JobResult } from '@shared/ml/jobs'
import { throwIfCancelled } from '../job-queue'
import { inpaintLama } from '../pipelines/inpaint/lama'
import { inpaintTelea } from '../pipelines/inpaint/telea'
import { textMask } from '../pipelines/inpaint/text-mask'
import { ModelMissingError } from '../session-pool'
import type { HandlerContext } from './context'

export async function inpaint(
  input: JobInput<'inpaint'>,
  ctx: HandlerContext
): Promise<JobResult<'inpaint'>> {
  const img = { width: input.width, height: input.height, data: input.pixels }
  const mask = input.mask
    ? { width: input.width, height: input.height, data: input.mask }
    : textMask(img, input.textRects ?? [])
  ctx.progress(0.1)

  if (input.quality === 'auto') {
    try {
      const lama = await ctx.pool.get('inpaint', 'lama_fp32.onnx')
      throwIfCancelled(ctx.signal)
      const out = await inpaintLama(lama.session, img, mask)
      return { pixels: out.data, method: 'lama' }
    } catch (error) {
      // Without the optional LaMa pack, fall back to the built-in fill.
      if (!(error instanceof ModelMissingError)) throw error
    }
  }
  throwIfCancelled(ctx.signal)
  return { pixels: inpaintTelea(img, mask.data).data, method: 'telea' }
}
