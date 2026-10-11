import { connectedComponents, minAreaRect, scaleRect, unclip, type RotatedRect } from '../../image/geometry'
import { resize, type Rgba } from '../../image/raster'

/** PP-OCRv5 mobile det config (inference.yml): BGR, ImageNet mean/std, DB post-process. */
export const DET = {
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  thresh: 0.3,
  boxThresh: 0.6,
  unclipRatio: 1.5,
  maxCandidates: 1000,
  minSize: 3,
  /** The config resizes the long side to 960; larger images keep up to 1920 so small text survives. */
  minLongSide: 960,
  maxLongSide: 1920
}

export interface DetInput {
  tensor: Float32Array
  width: number
  height: number
  /** Multiply det-space coordinates by these to get source coordinates. */
  scaleX: number
  scaleY: number
}

export interface DetBox {
  rect: RotatedRect
  score: number
}

/** Resizes so the long side is within [960, 1920] (multiples of 32) and normalizes to NCHW BGR. */
export function preprocessDet(src: Rgba): DetInput {
  const long = Math.max(src.width, src.height)
  const target = Math.min(DET.maxLongSide, Math.max(DET.minLongSide, long))
  const ratio = target / long
  const round32 = (v: number) => Math.max(32, Math.round((v * ratio) / 32) * 32)
  const width = round32(src.width)
  const height = round32(src.height)
  const img = resize(src, width, height)
  const plane = width * height
  const tensor = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    const r = (img.data[i * 4] as number) / 255
    const g = (img.data[i * 4 + 1] as number) / 255
    const b = (img.data[i * 4 + 2] as number) / 255
    // Channel order is B, G, R; mean/std apply in that order as in the reference implementation.
    tensor[i] = (b - (DET.mean[0] as number)) / (DET.std[0] as number)
    tensor[plane + i] = (g - (DET.mean[1] as number)) / (DET.std[1] as number)
    tensor[2 * plane + i] = (r - (DET.mean[2] as number)) / (DET.std[2] as number)
  }
  return { tensor, width, height, scaleX: src.width / width, scaleY: src.height / height }
}

/** DB post-processing: threshold → components → min-area rect → score filter → unclip → rescale. */
export function postprocessDet(prob: Float32Array, input: DetInput): DetBox[] {
  const { width, height } = input
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) mask[i] = (prob[i] as number) > DET.thresh ? 1 : 0

  const boxes: DetBox[] = []
  for (const component of connectedComponents(mask, width, height, 4).slice(0, DET.maxCandidates)) {
    const rect = minAreaRect(component.boundary)
    if (Math.min(rect.width, rect.height) < DET.minSize) continue
    let sum = 0
    for (const i of component.pixels) sum += prob[i] as number
    const score = sum / component.pixels.length
    if (score < DET.boxThresh) continue
    const grown = unclip(rect, DET.unclipRatio)
    if (Math.min(grown.width, grown.height) < DET.minSize + 2) continue
    boxes.push({ rect: scaleRect(grown, input.scaleX, input.scaleY), score })
  }
  // Reading order: top to bottom, then left to right on the same line.
  return boxes.sort((a, b) =>
    Math.abs(a.rect.cy - b.rect.cy) < Math.min(a.rect.height, b.rect.height) / 2
      ? a.rect.cx - b.rect.cx
      : a.rect.cy - b.rect.cy
  )
}
