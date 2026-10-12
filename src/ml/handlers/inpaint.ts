import type { JobInput, JobResult } from '@shared/ml/jobs'
import { throwIfCancelled } from '../job-queue'
import { inpaintAuto } from '../pipelines/inpaint/auto'
import { lamaInfer, type LamaInfer } from '../pipelines/inpaint/lama'
import { inpaintTelea } from '../pipelines/inpaint/telea'
import { textMask } from '../pipelines/inpaint/text-mask'
import { hasTransparency, inpaintTransparent } from '../pipelines/inpaint/transparent'
import type { Gray, Rgba } from '../image/raster'
import type { HandlerContext } from './context'

const LAMA_FILE = 'lama_fp32.onnx'

/** LaMa through the session pool (DirectML failures fall back to CPU), or null when not installed. */
function lamaRunner(ctx: HandlerContext): LamaInfer | null {
  try {
    ctx.pool.filePath('inpaint', LAMA_FILE)
  } catch {
    return null
  }
  return async (image, mask) =>
    (await ctx.pool.run('inpaint', LAMA_FILE, (s) => lamaInfer(s)(image, mask))).result
}

export async function inpaint(
  input: JobInput<'inpaint'>,
  ctx: HandlerContext
): Promise<JobResult<'inpaint'>> {
  const img = { width: input.width, height: input.height, data: input.pixels }
  const mask = input.mask
    ? { width: input.width, height: input.height, data: input.mask }
    : textMask(img, input.textRects ?? [])
  ctx.progress(0.05)
  throwIfCancelled(ctx.signal)

  const fill = async (image: Rgba, holes: Gray): Promise<{ image: Rgba; method: 'lama' | 'telea' }> => {
    if (input.quality === 'fast') return { image: inpaintTelea(image, holes.data), method: 'telea' }
    const result = await inpaintAuto(image, holes, lamaRunner(ctx), {
      progress: (p) => ctx.progress(0.05 + 0.9 * p),
      checkCancelled: () => throwIfCancelled(ctx.signal)
    })
    return { image: result.image, method: result.usedLama ? 'lama' : 'telea' }
  }
  // Transparent pixels usually store black: fill colour and opacity separately (images with alpha).
  const { image, method } = hasTransparency(img)
    ? await inpaintTransparent(img, mask, fill)
    : await fill(img, mask)
  return { pixels: image.data, method }
}
