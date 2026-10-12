import { Tensor } from 'onnxruntime-node'
import type { JobInput, JobResult } from '@shared/ml/jobs'
import { imagenetTensor } from '../image/tensor'
import { throwIfCancelled } from '../job-queue'
import { promptFeeds, SAM_EMBEDDINGS, SAM_SIZE, selectMask } from '../pipelines/segment/sam'
import type { HandlerContext } from './context'

const ENCODER = 'vision_encoder.onnx'
const DECODER = 'prompt_encoder_mask_decoder.onnx'

/** `segment` was called for an image that is not (or no longer) encoded. */
export class NotPreparedError extends Error {}

/** The last encoded image (≈17 MB of embeddings): clicks on it only run the small decoder. */
let prepared: {
  key: string
  width: number
  height: number
  provider: 'dml' | 'cpu'
  embeddings: Record<string, Tensor>
} | null = null

export async function segmentPrepare(
  input: JobInput<'segment-prepare'>,
  ctx: HandlerContext
): Promise<JobResult<'segment-prepare'>> {
  if (prepared?.key === input.key) return { provider: prepared.provider }
  prepared = null
  // Background removal's model is large; both together exceeded memory in testing.
  await ctx.pool.release(['remove-bg'])
  const image = imagenetTensor({ width: input.width, height: input.height, data: input.pixels }, SAM_SIZE)
  throwIfCancelled(ctx.signal)
  ctx.progress(0.2)
  const { result, provider } = await ctx.pool.run('segment', ENCODER, (s) =>
    s.run({ [s.inputNames[0] as string]: new Tensor('float32', image, [1, 3, SAM_SIZE, SAM_SIZE]) })
  )
  throwIfCancelled(ctx.signal)
  const embeddings: Record<string, Tensor> = {}
  for (const name of SAM_EMBEDDINGS) {
    const tensor = result[name]
    if (!tensor) throw new Error(`Selection model output ${name} is missing`)
    embeddings[name] = tensor as Tensor
  }
  prepared = { key: input.key, width: input.width, height: input.height, provider, embeddings }
  return { provider }
}

export async function segment(
  input: JobInput<'segment'>,
  ctx: HandlerContext
): Promise<JobResult<'segment'>> {
  const image = prepared
  if (image?.key !== input.key) throw new NotPreparedError('Image not prepared for selection')
  const { result } = await ctx.pool.run('segment', DECODER, (s) =>
    s.run({ ...promptFeeds(input, image.width, image.height), ...image.embeddings })
  )
  const masks = result['pred_masks']
  const scores = result['iou_scores']
  if (!masks || !scores) throw new Error('Selection model returned no mask')
  return selectMask(
    masks.data as Float32Array,
    masks.dims,
    scores.data as Float32Array,
    image.width,
    image.height,
    input
  )
}
