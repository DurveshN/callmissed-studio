import { connectedComponents, containsPoint, rectCorners, type RotatedRect } from './geometry'
import { otsu } from './morphology'
import type { Rgba } from './raster'

export interface InkMap {
  /** Pixel indices inside the rectangle. */
  indices: number[]
  /** Distance (0..255) of each of those pixels from its local background. */
  distances: Uint8Array
  /** Median color of the rectangle's border band. */
  background: [number, number, number]
}

type Rgb = [number, number, number]

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] as number
}

/**
 * How far each pixel inside `rect` is from its local background. The background is sampled along the
 * rectangle's two long edges at the same position along the text, so a line crossing different
 * backgrounds (photo, gradient, two panels) is not mistaken for ink. A pixel is close to background
 * when it matches either the edge above it or the edge below it.
 *
 * `sampleRect` (same angle, default `rect`) is where the edge bands are taken from; scanning a larger
 * `rect` than `sampleRect` finds ink just outside a box without sampling another surface as background.
 */
export function inkDistances(
  img: Rgba,
  rect: RotatedRect,
  smoothing = 3,
  sampleRect: RotatedRect = rect
): InkMap {
  const { width, height, data } = img
  const rad = (rect.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // Wide enough that a thin rule crossing the band (a table border) cannot dominate its median.
  const ring = Math.max(2, Math.round(sampleRect.height * 0.18))
  const half = Math.ceil(Math.max(rect.width, sampleRect.width) / 2)
  const bins = 2 * half + 1
  const top: number[][][] = Array.from({ length: bins }, () => [[], [], []])
  const bottom: number[][][] = Array.from({ length: bins }, () => [[], [], []])
  const border: [number[], number[], number[]] = [[], [], []]

  const corners = rectCorners(rect)
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))))
  const x1 = Math.min(width - 1, Math.ceil(Math.max(...corners.map((c) => c.x))))
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))))
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...corners.map((c) => c.y))))

  const indices: number[] = []
  const along: number[] = []
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5
      const py = y + 0.5
      if (!containsPoint(rect, px, py)) continue
      const dx = px - sampleRect.cx
      const dy = py - sampleRect.cy
      const u = dx * cos + dy * sin
      const v = -dx * sin + dy * cos
      const i = y * width + x
      const bin = Math.min(bins - 1, Math.max(0, Math.round(u) + half))
      indices.push(i)
      along.push(bin)
      const sampled = Math.abs(u) <= sampleRect.width / 2 && Math.abs(v) <= sampleRect.height / 2
      const edge = !sampled
        ? null
        : v < -sampleRect.height / 2 + ring
          ? top
          : v > sampleRect.height / 2 - ring
            ? bottom
            : null
      if (!edge) continue
      for (let c = 0; c < 3; c++) {
        ;(edge[bin] as number[][])[c]?.push(data[i * 4 + c] as number)
        border[c as 0 | 1 | 2].push(data[i * 4 + c] as number)
      }
    }
  }
  const background = border.map(median) as Rgb

  /** Median edge color per position, filled from neighbours where no samples landed, then smoothed. */
  const profile = (edge: number[][][]): Rgb[] => {
    const raw: (Rgb | null)[] = edge.map((ch) => ((ch[0] ?? []).length ? (ch.map(median) as Rgb) : null))
    const filled = raw.map((c, b) => c ?? nearest(raw, b) ?? background)
    return filled.map((_, b) => {
      const lo = Math.max(0, b - smoothing)
      const hi = Math.min(bins - 1, b + smoothing)
      const acc: Rgb = [0, 0, 0]
      for (let k = lo; k <= hi; k++)
        for (let c = 0; c < 3; c++) acc[c] = (acc[c] as number) + ((filled[k] as Rgb)[c] as number)
      return acc.map((s) => s / (hi - lo + 1)) as Rgb
    })
  }
  const above = profile(top)
  const below = profile(bottom)

  const distances = new Uint8Array(indices.length)
  indices.forEach((i, k) => {
    const pixel: Rgb = [data[i * 4] as number, data[i * 4 + 1] as number, data[i * 4 + 2] as number]
    const bin = along[k] as number
    const d = Math.min(dist(pixel, above[bin] as Rgb), dist(pixel, below[bin] as Rgb))
    distances[k] = Math.min(255, Math.round(d / Math.sqrt(3)))
  })
  return { indices, distances, background }
}

function nearest(values: (Rgb | null)[], at: number): Rgb | null {
  for (let d = 1; d < values.length; d++) {
    const left = values[at - d]
    if (left) return left
    const right = values[at + d]
    if (right) return right
  }
  return null
}

function dist(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/**
 * Which connected ink regions to keep: all of them; 'glyphs' (drop anything touching the top/bottom
 * band and horizontal rules — for measuring text); 'rules' (drop only thin, long lines — for erasing).
 */
export type InkFilter = 'none' | 'glyphs' | 'rules'

export interface InkPixels {
  /** Indices of ink pixels. */
  indices: number[]
  /** Ink pixels with their distance from the local background (for color estimation). */
  distances: Map<number, number>
  threshold: number
  background: [number, number, number]
}

/**
 * Ink pixels inside `rect`: farther from the local background than the Otsu threshold, with
 * background structures removed according to `filter` (see InkFilter).
 */
export function inkPixels(
  img: Rgba,
  rect: RotatedRect,
  filter: InkFilter,
  minThreshold = 24,
  sampleRect: RotatedRect = rect,
  /** Scales the Otsu threshold: below 1 also captures faint halos (used for erase masks). */
  thresholdScale = 1
): InkPixels {
  const ink = inkDistances(img, rect, 3, sampleRect)
  const threshold = Math.max(minThreshold, otsu(ink.distances) * thresholdScale)
  const distances = new Map<number, number>()
  ink.indices.forEach((i, k) => {
    const d = ink.distances[k] as number
    if (d > threshold) distances.set(i, d)
  })
  if (filter === 'none' || distances.size === 0) {
    return { indices: [...distances.keys()], distances, threshold, background: ink.background }
  }

  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const i of distances.keys()) {
    const x = i % img.width
    const y = (i - x) / img.width
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const local = new Uint8Array(w * h)
  for (const i of distances.keys()) local[(Math.floor(i / img.width) - y0) * w + (i % img.width) - x0] = 1

  const rad = (rect.angle * Math.PI) / 180
  const sin = Math.sin(rad)
  const cos = Math.cos(rad)
  const edgeV = rect.height / 2 - 1.5
  const edgeU = rect.width / 2 - 1.5
  const kept: number[] = []
  for (const component of connectedComponents(local, w, h)) {
    const global = Array.from(component.pixels, (j) => (Math.floor(j / w) + y0) * img.width + (j % w) + x0)
    let touchesTopBottom = false
    let touchesSide = false
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const i of global) {
      const px = (i % img.width) + 0.5 - rect.cx
      const py = Math.floor(i / img.width) + 0.5 - rect.cy
      const u = px * cos + py * sin
      const v = -px * sin + py * cos
      if (Math.abs(v) > edgeV) touchesTopBottom = true
      if (Math.abs(u) > edgeU) touchesSide = true
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    // A horizontal rule (table border, underline running off the box) enters from a side and is
    // longer than the text is tall; glyphs never are.
    const length = maxU - minU
    const thickness = maxV - minV
    const horizontalRule = touchesSide && length > rect.height * 1.2
    if (filter === 'glyphs') {
      if (!touchesTopBottom && !horizontalRule) kept.push(...global)
    } else {
      // Erasing keeps only genuine rules intact (thin and long); glyphs touching the box edge or a
      // border must still be erased, or the fill would smear their remains (ghost letters).
      const thinHorizontal = horizontalRule && thickness < rect.height * 0.3
      const thinVertical = thickness > rect.height * 0.9 && length < rect.height * 0.2
      if (!thinHorizontal && !thinVertical) kept.push(...global)
    }
  }
  const keptSet = new Set(kept)
  for (const i of [...distances.keys()]) if (!keptSet.has(i)) distances.delete(i)
  return { indices: kept, distances, threshold, background: ink.background }
}
