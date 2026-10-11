import { connectedComponents } from '../../image/geometry'
import { dilate } from '../../image/morphology'
import { createRgba, type Gray, type Rgba } from '../../image/raster'
import { inpaintLama, type LamaInfer } from './lama'
import { inpaintTelea } from './telea'

/** Masked areas closer than this (px) are inpainted together. */
const JOIN_DISTANCE = 24
/** A cluster stops growing once its box would exceed this side (keeps LaMa's 512 input near 1:1). */
const MAX_CLUSTER_SIDE = 320
/** Background whose surrounding ring varies less than this (per-channel std, 0..255) counts as flat. */
const FLAT_STD = 10
/** Ring around the mask used to judge the background. */
const RING = 4
/** Telea works on a crop around each cluster; this margin covers its sampling radius. */
const TELEA_MARGIN = 8

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

const side = (b: Box) => Math.max(b.x1 - b.x0, b.y1 - b.y0)
const union = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1)
})
const near = (a: Box, b: Box) =>
  a.x0 - JOIN_DISTANCE < b.x1 &&
  b.x0 - JOIN_DISTANCE < a.x1 &&
  a.y0 - JOIN_DISTANCE < b.y1 &&
  b.y0 - JOIN_DISTANCE < a.y1

/** Groups mask components into nearby clusters of bounded size. */
export function clusterMask(mask: Gray): Box[] {
  const boxes: Box[] = connectedComponents(mask.data, mask.width, mask.height).map((c) => {
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
    for (const p of c.boundary) {
      box.x0 = Math.min(box.x0, p.x)
      box.y0 = Math.min(box.y0, p.y)
      box.x1 = Math.max(box.x1, p.x + 1)
      box.y1 = Math.max(box.y1, p.y + 1)
    }
    return box
  })
  for (let merged = true; merged;) {
    merged = false
    for (let i = 0; i < boxes.length && !merged; i++) {
      for (let j = i + 1; j < boxes.length && !merged; j++) {
        const a = boxes[i] as Box
        const b = boxes[j] as Box
        const joined = union(a, b)
        if (near(a, b) && (side(joined) <= MAX_CLUSTER_SIDE || side(joined) <= Math.max(side(a), side(b)))) {
          boxes[i] = joined
          boxes.splice(j, 1)
          merged = true
        }
      }
    }
  }
  return boxes
}

/** Whether the pixels surrounding the masked area (within `box`) are a near-uniform color. */
export function isFlatBackground(img: Rgba, mask: Gray, box: Box): boolean {
  const pad = RING + 1
  const x0 = Math.max(0, box.x0 - pad)
  const y0 = Math.max(0, box.y0 - pad)
  const x1 = Math.min(img.width, box.x1 + pad)
  const y1 = Math.min(img.height, box.y1 + pad)
  const local: Gray = { width: x1 - x0, height: y1 - y0, data: new Uint8Array((x1 - x0) * (y1 - y0)) }
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++)
      local.data[(y - y0) * local.width + x - x0] = mask.data[y * mask.width + x] as number
  }
  const grown = dilate(local, RING)
  const sum = [0, 0, 0]
  const sq = [0, 0, 0]
  let n = 0
  for (let k = 0; k < grown.data.length; k++) {
    if (!grown.data[k] || local.data[k]) continue
    const i = ((y0 + Math.floor(k / local.width)) * img.width + x0 + (k % local.width)) * 4
    for (let c = 0; c < 3; c++) {
      const v = img.data[i + c] as number
      sum[c] = (sum[c] as number) + v
      sq[c] = (sq[c] as number) + v * v
    }
    n++
  }
  if (n === 0) return true
  return [0, 1, 2].every(
    (c) => Math.sqrt(Math.max(0, (sq[c] as number) / n - ((sum[c] as number) / n) ** 2)) < FLAT_STD
  )
}

function cropMask(mask: Gray, box: Box): Gray {
  const out: Gray = { width: mask.width, height: mask.height, data: new Uint8Array(mask.data.length) }
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++)
      out.data[y * mask.width + x] = mask.data[y * mask.width + x] as number
  }
  return out
}

/** Telea restricted to a crop around the cluster (fast even on large pages). */
function teleaInBox(img: Rgba, mask: Gray, box: Box): Rgba {
  const x0 = Math.max(0, box.x0 - TELEA_MARGIN)
  const y0 = Math.max(0, box.y0 - TELEA_MARGIN)
  const x1 = Math.min(img.width, box.x1 + TELEA_MARGIN)
  const y1 = Math.min(img.height, box.y1 + TELEA_MARGIN)
  const crop = createRgba(x1 - x0, y1 - y0)
  const m = new Uint8Array(crop.width * crop.height)
  for (let y = y0; y < y1; y++) {
    const row = (y * img.width + x0) * 4
    crop.data.set(img.data.subarray(row, row + crop.width * 4), (y - y0) * crop.width * 4)
    for (let x = x0; x < x1; x++) m[(y - y0) * crop.width + x - x0] = mask.data[y * mask.width + x] as number
  }
  const filled = inpaintTelea(crop, m)
  const out = { ...img, data: img.data.slice() }
  for (let y = y0; y < y1; y++) {
    out.data.set(
      filled.data.subarray((y - y0) * crop.width * 4, (y - y0 + 1) * crop.width * 4),
      (y * img.width + x0) * 4
    )
  }
  return out
}

/**
 * Inpaints `mask` cluster by cluster: flat surroundings (documents, diagrams, UI) use the exact and
 * instant Telea fill; textured surroundings (photos, gradients) use LaMa when available.
 */
export async function inpaintAuto(
  img: Rgba,
  mask: Gray,
  lama: LamaInfer | null,
  hooks: { progress(p: number): void; checkCancelled(): void }
): Promise<{ image: Rgba; usedLama: boolean }> {
  const clusters = clusterMask(mask)
  let out: Rgba = { ...img, data: img.data.slice() }
  let usedLama = false
  for (const [n, box] of clusters.entries()) {
    hooks.checkCancelled()
    const part = cropMask(mask, box)
    const flat = isFlatBackground(out, part, box)
    if (lama && !flat) {
      out = await inpaintLama(lama, out, part)
      usedLama = true
    } else {
      out = teleaInBox(out, part, box)
    }
    hooks.progress((n + 1) / clusters.length)
  }
  return { image: out, usedLama }
}
