import { Tensor } from 'onnxruntime-node'
import { connectedComponents } from '../../image/geometry'

/** SAM 2.1 works on a 1024×1024 stretch of the image; its masks come back as 256×256 logits. */
export const SAM_SIZE = 1024
/** Encoder outputs the decoder takes back, by name. */
export const SAM_EMBEDDINGS = ['image_embeddings.0', 'image_embeddings.1', 'image_embeddings.2'] as const

export interface SamPoint {
  x: number
  y: number
  /** 1 = part of the object, 0 = not. */
  label: 0 | 1
}

export interface SamPrompt {
  points: SamPoint[]
  box?: { x0: number; y0: number; x1: number; y1: number } | undefined
}

export interface MaskRegion {
  x: number
  y: number
  width: number
  height: number
  /** 255 inside the region. */
  data: Uint8Array
}

/** Decoder prompt inputs for a prompt given in pixels of a width×height image. */
export function promptFeeds(prompt: SamPrompt, width: number, height: number): Record<string, Tensor> {
  const sx = SAM_SIZE / width
  const sy = SAM_SIZE / height
  const n = prompt.points.length
  const box = prompt.box
  return {
    input_points: new Tensor(
      'float32',
      Float32Array.from(prompt.points.flatMap((p) => [p.x * sx, p.y * sy])),
      [1, 1, n, 2]
    ),
    input_labels: new Tensor('int64', BigInt64Array.from(prompt.points.map((p) => BigInt(p.label))), [
      1,
      1,
      n
    ]),
    // No box: an empty box list (verified with the onnx-community export).
    input_boxes: box
      ? new Tensor(
          'float32',
          Float32Array.from([
            Math.min(box.x0, box.x1) * sx,
            Math.min(box.y0, box.y1) * sy,
            Math.max(box.x0, box.x1) * sx,
            Math.max(box.y0, box.y1) * sy
          ]),
          [1, 1, 4]
        )
      : new Tensor('float32', new Float32Array(0), [1, 0, 4])
  }
}

/** Components smaller than this share of the largest are dropped from box selections (specks). */
const SPECK_RATIO = 0.02
/** Holes up to this share of the region (or HOLE_MIN_PX) are filled. Larger ones are real (a ring). */
const HOLE_RATIO = 0.01
const HOLE_MIN_PX = 64

/**
 * Turns SAM's candidate masks into one clean region of the width×height image: the candidate the
 * model rates best, upsampled from its low-resolution logits, limited to the parts that were clicked
 * (or, for a box, without specks), with small holes filled.
 */
export function selectMask(
  logits: Float32Array,
  dims: readonly number[],
  scores: Float32Array,
  width: number,
  height: number,
  prompt: SamPrompt
): { mask: MaskRegion | null; score: number } {
  const count = dims[2] as number
  const mh = dims[3] as number
  const mw = dims[4] as number
  let best = 0
  for (let k = 1; k < count; k++) if ((scores[k] as number) > (scores[best] as number)) best = k
  const score = scores[best] ?? 0
  const offset = best * mh * mw
  const at = (x: number, y: number) => logits[offset + y * mw + x] as number

  // Only scan the full-resolution area around positive low-resolution cells (plus one cell).
  let cx0 = mw
  let cy0 = mh
  let cx1 = -1
  let cy1 = -1
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      if (at(x, y) <= 0) continue
      cx0 = Math.min(cx0, x)
      cy0 = Math.min(cy0, y)
      cx1 = Math.max(cx1, x)
      cy1 = Math.max(cy1, y)
    }
  }
  if (cx1 < 0) return { mask: null, score }
  const fx = width / mw
  const fy = height / mh
  const x0 = Math.max(0, Math.floor((cx0 - 1) * fx))
  const y0 = Math.max(0, Math.floor((cy0 - 1) * fy))
  const x1 = Math.min(width, Math.ceil((cx1 + 2) * fx))
  const y1 = Math.min(height, Math.ceil((cy1 + 2) * fy))
  const w = x1 - x0
  const h = y1 - y0

  // Bilinear upsampling of the logits (pixel-centre aligned), thresholded at 0.
  const binary = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const ly = Math.min(mh - 1, Math.max(0, (y0 + y + 0.5) / fy - 0.5))
    const ty = Math.floor(ly)
    const by = Math.min(mh - 1, ty + 1)
    const wy = ly - ty
    for (let x = 0; x < w; x++) {
      const lx = Math.min(mw - 1, Math.max(0, (x0 + x + 0.5) / fx - 0.5))
      const lx0 = Math.floor(lx)
      const lx1 = Math.min(mw - 1, lx0 + 1)
      const wx = lx - lx0
      const top = at(lx0, ty) * (1 - wx) + at(lx1, ty) * wx
      const bottom = at(lx0, by) * (1 - wx) + at(lx1, by) * wx
      if (top * (1 - wy) + bottom * wy > 0) binary[y * w + x] = 1
    }
  }

  const components = connectedComponents(binary, w, h)
  if (components.length === 0) return { mask: null, score }
  const clicked = prompt.points
    .filter((p) => p.label === 1)
    .map((p) => Math.floor(p.y - y0) * w + Math.floor(p.x - x0))
  const largest = Math.max(...components.map((c) => c.pixels.length))
  let kept = components.filter((c) => clicked.some((i) => c.pixels.includes(i)))
  if (kept.length === 0) {
    kept =
      clicked.length > 0
        ? components.filter((c) => c.pixels.length === largest)
        : components.filter((c) => c.pixels.length >= largest * SPECK_RATIO)
  }
  const region = new Uint8Array(w * h)
  let area = 0
  for (const c of kept) {
    for (const i of c.pixels) region[i] = 1
    area += c.pixels.length
  }
  fillSmallHoles(region, w, h, Math.max(HOLE_MIN_PX, area * HOLE_RATIO))
  return { mask: tight(region, w, h, x0, y0), score }
}

/** Fills background islands that don't reach the crop edge and are at most `maxArea` pixels. */
function fillSmallHoles(region: Uint8Array, w: number, h: number, maxArea: number): void {
  const background = new Uint8Array(region.length)
  for (let i = 0; i < region.length; i++) background[i] = region[i] ? 0 : 1
  for (const hole of connectedComponents(background, w, h)) {
    if (hole.pixels.length > maxArea) continue
    const open = hole.boundary.some((p) => p.x === 0 || p.y === 0 || p.x === w - 1 || p.y === h - 1)
    if (!open) for (const i of hole.pixels) region[i] = 1
  }
}

/** The region cropped to its bounding box, as 0/255, in image coordinates. */
function tight(region: Uint8Array, w: number, h: number, ox: number, oy: number): MaskRegion | null {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!region[y * w + x]) continue
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  if (x1 < 0) return null
  const width = x1 - x0 + 1
  const height = y1 - y0 + 1
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (region[(y0 + y) * w + x0 + x]) data[y * width + x] = 255
  }
  return { x: ox + x0, y: oy + y0, width, height, data }
}
