import { Tensor, type InferenceSession } from 'onnxruntime-node'
import { rectCorners, type RotatedRect } from '../../image/geometry'
import { warpQuad, type Gray, type Rgba } from '../../image/raster'
import { postprocessDet, preprocessDet } from './det'
import { groupLines } from './lines'
import { buildRecBatch, cropLine, ctcDecode, dropFalseSpaces, recWidth, REC } from './rec'
import { refineLine } from './refine'
import { estimateStyle, type LineStyle } from './style'

/** A column is a rule when dark pixels fill this share of a band taller than the text. */
const RULE_COVERAGE = 0.85

/**
 * Whether a vertical line (table border, separator) runs between two word boxes. Letters never fill a
 * band 1.6× taller than the words, while a rule crosses all of it.
 */
export function verticalRuleBetween(src: Rgba, a: RotatedRect, b: RotatedRect): boolean {
  const rad = (a.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const along = (r: RotatedRect) => r.cx * cos + r.cy * sin
  const [left, right] = along(a) <= along(b) ? [a, b] : [b, a]
  const u0 = along(left)
  const u1 = along(right)
  const vMid = (-left.cx * sin + left.cy * cos + (-right.cx * sin + right.cy * cos)) / 2
  const half = (Math.max(a.height, b.height) * 1.6) / 2

  const lum = (x: number, y: number) => {
    const xi = Math.min(src.width - 1, Math.max(0, Math.round(x)))
    const yi = Math.min(src.height - 1, Math.max(0, Math.round(y)))
    const i = (yi * src.width + xi) * 4
    return (
      0.299 * (src.data[i] as number) +
      0.587 * (src.data[i + 1] as number) +
      0.114 * (src.data[i + 2] as number)
    )
  }
  const samples: number[][] = []
  for (let u = u0; u <= u1; u += 1) {
    const column: number[] = []
    for (let v = vMid - half; v <= vMid + half; v += 1) column.push(lum(u * cos - v * sin, u * sin + v * cos))
    samples.push(column)
  }
  // Background = the most common tone (median); a rule differs from it in either direction
  // (dark lines on paper, light lines on dark panels).
  const all = samples.flat().sort((x, y) => x - y)
  const background = all[Math.floor(all.length / 2)] ?? 255
  return samples.some(
    (column) => column.filter((l) => Math.abs(l - background) > 40).length / column.length >= RULE_COVERAGE
  )
}

/** Ink amount per column (in pixels) of a coverage mask. */
function inkColumns(mask: Gray): Float32Array {
  const out = new Float32Array(mask.width)
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++)
      out[x] = (out[x] as number) + (mask.data[y * mask.width + x] as number) / 255
  }
  return out
}

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

/** Runs a single-input, single-output model. */
export type Infer = (
  data: Float32Array,
  dims: readonly number[]
) => Promise<{ data: Float32Array; dims: readonly number[] }>

export interface OcrModels {
  det: Infer
  rec: Infer
  dict: string[]
}

export function sessionInfer(session: InferenceSession): Infer {
  return async (data, dims) => {
    const input = session.inputNames[0] as string
    const outputs = await session.run({ [input]: new Tensor('float32', data, dims) })
    const out = outputs[session.outputNames[0] as string]
    if (!out) throw new Error('Model produced no output')
    return { data: out.data as Float32Array, dims: out.dims }
  }
}

export async function runOcr(
  src: Rgba,
  models: OcrModels,
  hooks: { progress(p: number): void; checkCancelled(): void }
): Promise<OcrLine[]> {
  const det = preprocessDet(src)
  const prob = await models.det(det.tensor, [1, 3, det.height, det.width])
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
    const out = await models.rec(batch.tensor, batch.dims)
    ctcDecode(out.data, out.dims, models.dict).forEach((r, k) => (texts[ids[k] as number] = r))
    hooks.progress(0.3 + 0.6 * Math.min(1, (start + REC.batchSize) / Math.max(1, order.length)))
  }

  const words = boxes.flatMap((box, i) => {
    const recognized = texts[i]
    if (!recognized || !recognized.text || recognized.confidence < MIN_CONFIDENCE) return []
    return [{ ...recognized, rect: box.rect }]
  })
  const grouped = groupLines(words, (a, b) => verticalRuleBetween(src, a, b)).map(
    ({ words: _merged, ...line }) => {
      const rect = refineLine(src, line.rect)
      const crop = warpQuad(
        src,
        rectCorners(rect),
        Math.max(1, Math.round(rect.width)),
        Math.max(1, Math.round(rect.height))
      )
      const { mask, ...style } = estimateStyle(crop)
      return { ...line, rect, style, mask }
    }
  )

  // Read every line again as a whole: the recognizer places spaces from the pixels (word boxes alone
  // cannot tell), and spaces without a visible gap in the ink are dropped.
  const lineCrops = grouped.map((line) => cropLine(src, line.rect))
  const lineOrder = lineCrops
    .map((_, i) => i)
    .sort((a, b) => recWidth(lineCrops[a] as Rgba) - recWidth(lineCrops[b] as Rgba))
  for (let start = 0; start < lineOrder.length; start += REC.batchSize) {
    hooks.checkCancelled()
    const ids = lineOrder.slice(start, start + REC.batchSize)
    const batch = buildRecBatch(ids.map((i) => lineCrops[i] as Rgba))
    const out = await models.rec(batch.tensor, batch.dims)
    ctcDecode(out.data, out.dims, models.dict).forEach((read, k) => {
      const index = ids[k] as number
      const line = grouped[index]
      const crop = lineCrops[index] as Rgba
      if (!line || !read.text || read.confidence < Math.max(MIN_CONFIDENCE, line.confidence - 0.05)) return
      // The whole-line read is trusted for spacing; where it disagrees on the characters themselves,
      // the more confident of the two reads wins.
      const letters = (t: string) => t.replace(/\s+/g, '')
      if (letters(read.text) !== letters(line.text) && read.confidence <= line.confidence) return
      // Vertical lines were rotated for recognition; their columns don't match the style mask.
      const upright = crop.width === line.mask.width
      line.text = upright
        ? dropFalseSpaces(
            read,
            {
              batchWidth: batch.dims[3],
              scaledWidth: recWidth(crop),
              cropWidth: crop.width,
              inkHeight: Math.max(1, line.style.inkBottom - line.style.inkTop)
            },
            inkColumns(line.mask)
          )
        : read.text
      line.confidence = read.confidence
    })
  }

  const lines: OcrLine[] = grouped.filter((line) => line.text)
  hooks.progress(1)
  return lines
}
