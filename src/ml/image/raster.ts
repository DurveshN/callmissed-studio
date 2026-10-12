/** 8-bit RGBA image, row-major. */
export interface Rgba {
  width: number
  height: number
  data: Uint8Array
}

/** Single-channel 8-bit image (masks, 0 or 255). */
export interface Gray {
  width: number
  height: number
  data: Uint8Array
}

export function createRgba(width: number, height: number): Rgba {
  return { width, height, data: new Uint8Array(width * height * 4) }
}

/** Samples `src` at a fractional position with bilinear filtering (edges clamped). */
export function sample(src: Rgba, x: number, y: number, out: Uint8Array, offset: number): void {
  const maxX = src.width - 1
  const maxY = src.height - 1
  const cx = Math.min(Math.max(x, 0), maxX)
  const cy = Math.min(Math.max(y, 0), maxY)
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(x0 + 1, maxX)
  const y1 = Math.min(y0 + 1, maxY)
  const fx = cx - x0
  const fy = cy - y0
  const d = src.data
  const i00 = (y0 * src.width + x0) * 4
  const i10 = (y0 * src.width + x1) * 4
  const i01 = (y1 * src.width + x0) * 4
  const i11 = (y1 * src.width + x1) * 4
  for (let c = 0; c < 4; c++) {
    const top = (d[i00 + c] as number) * (1 - fx) + (d[i10 + c] as number) * fx
    const bottom = (d[i01 + c] as number) * (1 - fx) + (d[i11 + c] as number) * fx
    out[offset + c] = Math.round(top * (1 - fy) + bottom * fy)
  }
}

/** Bilinear resize using pixel-center alignment. */
export function resize(src: Rgba, width: number, height: number): Rgba {
  const dst = createRgba(width, height)
  const sx = src.width / width
  const sy = src.height / height
  for (let y = 0; y < height; y++) {
    const srcY = (y + 0.5) * sy - 0.5
    for (let x = 0; x < width; x++) sample(src, (x + 0.5) * sx - 0.5, srcY, dst.data, (y * width + x) * 4)
  }
  return dst
}

/**
 * Extracts the quadrilateral `corners` (top-left, top-right, bottom-right, bottom-left in source pixels)
 * into an upright width×height image. Works for any rotated rectangle.
 */
export function warpQuad(src: Rgba, corners: Point[], width: number, height: number): Rgba {
  const [tl, tr, , bl] = corners as [Point, Point, Point, Point]
  const ux = (tr.x - tl.x) / width
  const uy = (tr.y - tl.y) / width
  const vx = (bl.x - tl.x) / height
  const vy = (bl.y - tl.y) / height
  const dst = createRgba(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x + 0.5
      const v = y + 0.5
      sample(src, tl.x + u * ux + v * vx - 0.5, tl.y + u * uy + v * vy - 0.5, dst.data, (y * width + x) * 4)
    }
  }
  return dst
}

/** Rotates 90° counter-clockwise (used for vertical text lines). */
export function rotate90ccw(src: Rgba): Rgba {
  const dst = createRgba(src.height, src.width)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const from = (y * src.width + x) * 4
      const to = ((src.width - 1 - x) * dst.width + y) * 4
      dst.data.set(src.data.subarray(from, from + 4), to)
    }
  }
  return dst
}

export interface Point {
  x: number
  y: number
}

export function toHex(r: number, g: number, b: number): string {
  const h = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** Contributions of source pixels to each output pixel of a 1-D triangle-filter resize. */
function triangleTaps(inSize: number, outSize: number): { start: number; weights: Float32Array }[] {
  const scale = inSize / outSize
  // Widening the filter when shrinking averages all covered pixels instead of skipping some (aliasing).
  const support = Math.max(1, scale)
  return Array.from({ length: outSize }, (_, i) => {
    const center = (i + 0.5) * scale
    const start = Math.max(0, Math.floor(center - support))
    const end = Math.min(inSize, Math.ceil(center + support))
    const weights = new Float32Array(end - start)
    let sum = 0
    for (let j = start; j < end; j++) {
      const w = Math.max(0, 1 - Math.abs((j + 0.5 - center) / support))
      weights[j - start] = w
      sum += w
    }
    if (sum > 0) for (let k = 0; k < weights.length; k++) weights[k] = (weights[k] as number) / sum
    return { start, weights }
  })
}

/** Bilinear resize that also averages properly when shrinking (like PIL's BILINEAR). */
export function resizeSmooth(src: Rgba, width: number, height: number): Rgba {
  const xTaps = triangleTaps(src.width, width)
  const yTaps = triangleTaps(src.height, height)
  const tmp = new Float32Array(width * src.height * 4)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < width; x++) {
      const { start, weights } = xTaps[x] as { start: number; weights: Float32Array }
      const o = (y * width + x) * 4
      for (let k = 0; k < weights.length; k++) {
        const i = (y * src.width + start + k) * 4
        const w = weights[k] as number
        for (let c = 0; c < 4; c++) tmp[o + c] = (tmp[o + c] as number) + (src.data[i + c] as number) * w
      }
    }
  }
  const dst = createRgba(width, height)
  for (let y = 0; y < height; y++) {
    const { start, weights } = yTaps[y] as { start: number; weights: Float32Array }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      for (let c = 0; c < 4; c++) {
        let v = 0
        for (let k = 0; k < weights.length; k++)
          v += (tmp[((start + k) * width + x) * 4 + c] as number) * (weights[k] as number)
        dst.data[o + c] = Math.round(Math.min(255, Math.max(0, v)))
      }
    }
  }
  return dst
}
