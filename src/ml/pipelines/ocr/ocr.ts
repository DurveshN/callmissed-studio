import { Tensor, type InferenceSession } from 'onnxruntime-node'
import { rectCorners, type RotatedRect } from '../../image/geometry'
import { warpQuad, type Gray, type Rgba } from '../../image/raster'
import { postprocessDet, preprocessDet } from './det'
import { groupLines } from './lines'
import { buildRecBatch, cropLine, ctcDecode, recWidth, REC } from './rec'
import { estimateStyle, type LineStyle } from './style'

/** Lines below this recognition confidence are dropped (PaddleOCR's default drop_score). */
export const MIN_CONFIDENCE = 0.5

export interface OcrLine {
  text: string
  confidence: number
  /** Detected (unclipped) box in source pixels. */
  rect: RotatedRect
  style: Omit<LineStyle, 'mask'>
  mask: Gray
}

export interface OcrModels {
  det: InferenceSession
  rec: InferenceSession
  dict: string[]
}

async function run(session: InferenceSession, data: Float32Array, dims: readonly number[]) {
  const input = session.inputNames[0] as string
  const outputs = await session.run({ [input]: new Tensor('float32', data, dims) })
  const out = outputs[session.outputNames[0] as string]
  if (!out) throw new Error('Model produced no output')
  return { data: out.data as Float32Array, dims: out.dims }
}

export async function runOcr(
  src: Rgba,
  models: OcrModels,
  hooks: { progress(p: number): void; checkCancelled(): void }
): Promise<OcrLine[]> {
  const det = preprocessDet(src)
  const prob = await run(models.det, det.tensor, [1, 3, det.height, det.width])
  hooks.checkCancelled()
  hooks.progress(0.3)

  const boxes = postprocessDet(prob.data, det)
  const crops = boxes.map((b) => cropLine(src, b.rect))
  // Batch crops of similar aspect ratio to minimize padding.
  const order = crops.map((_, i) => i).sort((a, b) => recWidth(crops[a] as Rgba) - recWidth(crops[b] as Rgba))
  const texts = new Array<{ text: string; confidence: number }>(crops.length)
  for (let start = 0; start < order.length; start += REC.batchSize) {
    hooks.checkCancelled()
    const ids = order.slice(start, start + REC.batchSize)
    const batch = buildRecBatch(ids.map((i) => crops[i] as Rgba))
    const out = await run(models.rec, batch.tensor, batch.dims)
    ctcDecode(out.data, out.dims, models.dict).forEach((r, k) => (texts[ids[k] as number] = r))
    hooks.progress(0.3 + 0.6 * Math.min(1, (start + REC.batchSize) / Math.max(1, order.length)))
  }

  const words = boxes.flatMap((box, i) => {
    const recognized = texts[i]
    if (!recognized || !recognized.text || recognized.confidence < MIN_CONFIDENCE) return []
    return [{ ...recognized, rect: box.rect }]
  })
  const lines: OcrLine[] = groupLines(words).map((line) => {
    const { rect } = line
    const crop = warpQuad(
      src,
      rectCorners(rect),
      Math.max(1, Math.round(rect.width)),
      Math.max(1, Math.round(rect.height))
    )
    const { mask, ...style } = estimateStyle(crop)
    return { ...line, style, mask }
  })
  hooks.progress(1)
  return lines
}
