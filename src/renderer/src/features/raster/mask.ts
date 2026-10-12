import type { MaskCrop } from '@shared/ml/jobs'

/** A rectangle of raster pixels. */
export interface PixelRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** The mask dilated by `radius` pixels (square), within a width×height raster. */
export function growMask(mask: MaskCrop, radius: number, width: number, height: number): MaskCrop {
  const r = Math.max(0, Math.round(radius))
  const x0 = Math.max(0, mask.x - r)
  const y0 = Math.max(0, mask.y - r)
  const x1 = Math.min(width, mask.x + mask.width + r)
  const y1 = Math.min(height, mask.y + mask.height + r)
  const w = x1 - x0
  const h = y1 - y0
  const source = (x: number, y: number) => {
    const mx = x + x0 - mask.x
    const my = y + y0 - mask.y
    return mx >= 0 && my >= 0 && mx < mask.width && my < mask.height ? mask.data[my * mask.width + mx] : 0
  }
  // Separable max filter: rows, then columns.
  const rows = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && !v; k++) v = source(k, y) ?? 0
      rows[y * w + x] = v ? 255 : 0
    }
  }
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && !v; k++) v = rows[k * w + x] as number
      data[y * w + x] = v ? 255 : 0
    }
  }
  return { x: x0, y: y0, width: w, height: h, data }
}

/** Pixels covered by a round brush of `radius` dragged along `points`, within a width×height raster. */
export function strokeMask(points: Point[], radius: number, width: number, height: number): MaskCrop | null {
  if (points.length === 0 || radius <= 0) return null
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - radius))
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - radius))
  const x1 = Math.min(width, Math.ceil(Math.max(...xs) + radius) + 1)
  const y1 = Math.min(height, Math.ceil(Math.max(...ys) + radius) + 1)
  if (x1 <= x0 || y1 <= y0) return null
  const w = x1 - x0
  const h = y1 - y0
  const data = new Uint8Array(w * h)
  const r2 = radius * radius
  const segments =
    points.length === 1
      ? [[points[0], points[0]] as const]
      : points.slice(1).map((p, i) => [points[i], p] as const)
  for (const [a, b] of segments) {
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const bx0 = Math.max(x0, Math.floor(Math.min(a.x, b.x) - radius))
    const by0 = Math.max(y0, Math.floor(Math.min(a.y, b.y) - radius))
    const bx1 = Math.min(x1, Math.ceil(Math.max(a.x, b.x) + radius) + 1)
    const by1 = Math.min(y1, Math.ceil(Math.max(a.y, b.y) + radius) + 1)
    for (let y = by0; y < by1; y++) {
      for (let x = bx0; x < bx1; x++) {
        // Distance from the pixel centre to the segment.
        const px = x + 0.5
        const py = y + 0.5
        const t = len2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0
        const ex = px - (a.x + t * dx)
        const ey = py - (a.y + t * dy)
        if (ex * ex + ey * ey <= r2) data[(y - y0) * w + x - x0] = 255
      }
    }
  }
  return { x: x0, y: y0, width: w, height: h, data }
}

/** The mask's bounding box grown by `margin`, within a width×height raster. */
export function maskRegion(mask: MaskCrop, margin: number, width: number, height: number): PixelRegion {
  const x = Math.max(0, Math.floor(mask.x - margin))
  const y = Math.max(0, Math.floor(mask.y - margin))
  return {
    x,
    y,
    width: Math.min(width, Math.ceil(mask.x + mask.width + margin)) - x,
    height: Math.min(height, Math.ceil(mask.y + mask.height + margin)) - y
  }
}

/** The mask laid into `region` (region-sized, 255 = masked). */
export function maskInRegion(mask: MaskCrop, region: PixelRegion): Uint8Array {
  const out = new Uint8Array(region.width * region.height)
  for (let y = 0; y < mask.height; y++) {
    const ry = mask.y + y - region.y
    if (ry < 0 || ry >= region.height) continue
    for (let x = 0; x < mask.width; x++) {
      const rx = mask.x + x - region.x
      if (rx >= 0 && rx < region.width && mask.data[y * mask.width + x]) out[ry * region.width + rx] = 255
    }
  }
  return out
}

/** Pixels of `rgba` (width wide) inside `region`, with alpha multiplied by the mask (soft cut-out). */
export function cutoutPixels(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  mask: MaskCrop
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.width * mask.height * 4)
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const m = mask.data[y * mask.width + x] as number
      if (!m) continue
      const s = ((mask.y + y) * width + mask.x + x) * 4
      const o = (y * mask.width + x) * 4
      out[o] = rgba[s] as number
      out[o + 1] = rgba[s + 1] as number
      out[o + 2] = rgba[s + 2] as number
      out[o + 3] = Math.round(((rgba[s + 3] as number) * m) / 255)
    }
  }
  return out
}

/** Soft-edged copy of a 0/255 mask (3×3 average, one pixel larger): anti-aliased cut-out edges. */
export function featherMask(mask: MaskCrop, width: number, height: number): MaskCrop {
  const grown = growMask(mask, 1, width, height)
  const src = maskInRegion(mask, grown)
  const data = new Uint8Array(src.length)
  for (let y = 0; y < grown.height; y++) {
    for (let x = 0; x < grown.width; x++) {
      let sum = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= grown.width || yy >= grown.height) continue
          sum += src[yy * grown.width + xx] as number
          n++
        }
      }
      data[y * grown.width + x] = Math.round(sum / n)
    }
  }
  return { ...grown, data }
}
