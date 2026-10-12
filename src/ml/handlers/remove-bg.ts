import { Tensor } from 'onnxruntime-node'
import type { JobInput, JobResult } from '@shared/ml/jobs'
import { imagenetTensor } from '../image/tensor'
import { throwIfCancelled } from '../job-queue'
import { BIREFNET_SIZE, matteFromLogits } from '../pipelines/matting/birefnet'
import type { HandlerContext } from './context'

export async function removeBg(
  input: JobInput<'remove-bg'>,
  ctx: HandlerContext
): Promise<JobResult<'remove-bg'>> {
  // BiRefNet needs ~1 GB while running; free the other large models first (memory ran out in testing).
  await ctx.pool.release(['segment', 'inpaint'])
  const image = imagenetTensor(
    { width: input.width, height: input.height, data: input.pixels },
    BIREFNET_SIZE
  )
  throwIfCancelled(ctx.signal)
  ctx.progress(0.1)
  const { result, provider } = await ctx.pool.run('remove-bg', 'model.onnx', async (s) => {
    const out = await s.run({
      [s.inputNames[0] as string]: new Tensor('float32', image, [1, 3, BIREFNET_SIZE, BIREFNET_SIZE])
    })
    const logits = out[s.outputNames[0] as string]
    if (!logits) throw new Error('Background model returned no output')
    return logits.data as Float32Array
  })
  throwIfCancelled(ctx.signal)
  ctx.progress(0.9)
  return { alpha: matteFromLogits(result, BIREFNET_SIZE, input.width, input.height), provider }
}
