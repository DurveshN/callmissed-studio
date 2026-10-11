import { rectCorners, type RotatedRect } from '../../image/geometry'
import { resize, rotate90ccw, warpQuad, type Rgba } from '../../image/raster'

export const REC = {
  height: 48,
  minWidth: 16,
  maxWidth: 3200,
  batchSize: 8
}

/** Crops a detected line upright; tall crops are treated as vertical text and rotated. */
export function cropLine(src: Rgba, rect: RotatedRect): Rgba {
  const crop = warpQuad(
    src,
    rectCorners(rect),
    Math.max(1, Math.round(rect.width)),
    Math.max(1, Math.round(rect.height))
  )
  return crop.height / crop.width >= 1.5 ? rotate90ccw(crop) : crop
}

/** Width a crop occupies once scaled to the recognizer height. */
export function recWidth(crop: Rgba): number {
  return Math.min(REC.maxWidth, Math.max(REC.minWidth, Math.ceil((REC.height * crop.width) / crop.height)))
}

/** Builds an NCHW BGR batch normalized to [-1, 1], right-padded with zeros to the widest crop. */
export function buildRecBatch(crops: Rgba[]): {
  tensor: Float32Array
  dims: [number, number, number, number]
} {
  const width = Math.max(...crops.map(recWidth))
  const plane = REC.height * width
  const tensor = new Float32Array(crops.length * 3 * plane)
  crops.forEach((crop, n) => {
    const w = recWidth(crop)
    const img = resize(crop, w, REC.height)
    const base = n * 3 * plane
    for (let y = 0; y < REC.height; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4
        const d = y * width + x
        tensor[base + d] = ((img.data[s + 2] as number) / 255 - 0.5) / 0.5
        tensor[base + plane + d] = ((img.data[s + 1] as number) / 255 - 0.5) / 0.5
        tensor[base + 2 * plane + d] = ((img.data[s] as number) / 255 - 0.5) / 0.5
      }
    }
  })
  return { tensor, dims: [crops.length, 3, REC.height, width] }
}

export interface Recognized {
  text: string
  confidence: number
}

/**
 * Greedy CTC decode of [batch, time, classes] probabilities.
 * Class 0 is the blank, 1..dict.length map to the dictionary, and the last class is a space.
 */
export function ctcDecode(probs: Float32Array, dims: readonly number[], dict: string[]): Recognized[] {
  const [batch, steps, classes] = dims as [number, number, number]
  const out: Recognized[] = []
  for (let n = 0; n < batch; n++) {
    let text = ''
    let confidence = 0
    let kept = 0
    let previous = -1
    for (let t = 0; t < steps; t++) {
      const base = (n * steps + t) * classes
      let best = 0
      let bestP = -Infinity
      for (let c = 0; c < classes; c++) {
        const p = probs[base + c] as number
        if (p > bestP) {
          bestP = p
          best = c
        }
      }
      if (best !== 0 && best !== previous) {
        text += best <= dict.length ? (dict[best - 1] as string) : ' '
        confidence += bestP
        kept++
      }
      previous = best
    }
    out.push({ text: text.trim(), confidence: kept ? confidence / kept : 0 })
  }
  return out
}
