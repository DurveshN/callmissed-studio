import { connectedComponents } from '../../image/geometry'
import { inkPixels } from '../../image/ink'
import { toHex, type Gray, type Rgba } from '../../image/raster'

export interface LineStyle {
  color: string
  background: string
  /** Vertical extent of ink inside the crop (pixels from the crop top). */
  inkTop: number
  inkBottom: number
  /** Average stroke thickness in crop pixels. */
  strokeWidth: number
  /** Ink coverage of the crop: 0 = background, 255 = fully ink, in between for anti-aliased edges. */
  mask: Gray
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] as number
}

/**
 * Estimates text color, background color, ink extent and stroke width of an upright line crop.
 * Ink = pixels far from the local background (see inkPixels), ignoring background structures that
 * run into the crop's top or bottom edge.
 */
export function estimateStyle(crop: Rgba): LineStyle {
  const { width, height, data } = crop
  const ink = inkPixels(crop, { cx: width / 2, cy: height / 2, width, height, angle: 0 }, 'glyphs')
  // Anti-aliased edges blend toward the background, so the core of the strokes defines the color.
  const strongCut = Math.min(255, ink.threshold + (255 - ink.threshold) * 0.35)

  const mask = new Uint8Array(width * height)
  const strong: [number[], number[], number[]] = [[], [], []]
  const all: [number[], number[], number[]] = [[], [], []]
  let area = 0
  const strongDistances: number[] = []
  for (const [p, d] of ink.distances) {
    area++
    const target = d >= strongCut ? strong : all
    if (d >= strongCut) strongDistances.push(d)
    for (let c = 0; c < 3; c++) target[c as 0 | 1 | 2].push(data[p * 4 + c] as number)
  }
  const color = (strong[0].length ? strong : all).map(median) as [number, number, number]
  // Soft coverage: anti-aliased edges are partly ink, like the edges of rendered candidate fonts.
  // (A binary mask counts them as full ink and makes small regular text look bold.)
  // Full ink = the stroke contrast of nearby columns, so uneven lighting along a photographed line
  // (bright at one end, dim at the other) doesn't make part of the text look thin.
  const full = localFullContrast(ink.distances, width, Math.max(4, Math.round(height)), strongCut)
  for (const [p, d] of ink.distances) {
    mask[p] = Math.max(1, Math.min(255, Math.round((255 * d) / (full[p % width] as number))))
  }
  dropStrayIslands(mask, width, height)

  let inkTop = height
  let inkBottom = 0
  let perimeter = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (!mask[p]) continue
      if (y < inkTop) inkTop = y
      if (y + 1 > inkBottom) inkBottom = y + 1
      if (x === 0 || !mask[p - 1]) perimeter++
      if (x === width - 1 || !mask[p + 1]) perimeter++
      if (y === 0 || !mask[p - width]) perimeter++
      if (y === height - 1 || !mask[p + width]) perimeter++
    }
  }
  if (inkTop > inkBottom) {
    inkTop = 0
    inkBottom = height
  }

  return {
    color: toHex(...color),
    background: toHex(...ink.background),
    inkTop,
    inkBottom,
    // For strokes of thickness s and total length L: area ≈ s·L and perimeter ≈ 2L.
    strokeWidth: perimeter ? (2 * area) / perimeter : 0,
    mask: { width, height, data: mask }
  }
}

/**
 * Removes ink islands lying entirely above or below the line's core band (rows holding at least a
 * quarter of the busiest row's ink) that the crop edge cuts off: fragments of neighbouring lines.
 * A line's own ascenders and descenders overlap the band, and i-dots or accents don't reach the edge.
 */
function dropStrayIslands(mask: Uint8Array, width: number, height: number): void {
  const rows = new Float32Array(height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rows[y] = (rows[y] as number) + (mask[y * width + x] as number)
  const peak = Math.max(...rows)
  if (peak <= 0) return
  let bandTop = -1
  let bandBottom = -1
  for (let y = 0; y < height; y++) {
    if ((rows[y] as number) < peak * 0.25) continue
    if (bandTop < 0) bandTop = y
    bandBottom = y
  }
  const binary = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) binary[i] = mask[i] ? 1 : 0
  for (const island of connectedComponents(binary, width, height)) {
    let top = height
    let bottom = -1
    for (const i of island.pixels) {
      const y = Math.floor(i / width)
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
    // Neighbouring lines are cut off by the crop edge; i-dots and accents float freely inside it.
    const cutOff = top === 0 || bottom === height - 1
    if (cutOff && (bottom < bandTop || top > bandBottom)) for (const i of island.pixels) mask[i] = 0
  }
}

/**
 * Per column: median stroke contrast (distances above `strongCut`) within ±`radius` columns, never
 * below 60% of the line-wide median. On evenly lit text this equals the line-wide value.
 */
function localFullContrast(
  distances: Map<number, number>,
  width: number,
  radius: number,
  strongCut: number
): Float32Array {
  const byColumn: number[][] = Array.from({ length: width }, () => [])
  for (const [p, d] of distances) if (d >= strongCut) byColumn[p % width]?.push(d)
  const all = byColumn.flat()
  const global = Math.max(1, median(all.length ? all : [...distances.values()]))
  const out = new Float32Array(width)
  for (let x = 0; x < width; x++) {
    const near: number[] = []
    for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k++)
      near.push(...(byColumn[k] ?? []))
    out[x] = near.length >= 8 ? Math.max(0.6 * global, median(near)) : global
  }
  return out
}
