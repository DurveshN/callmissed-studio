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
  const ink = inkPixels(crop, { cx: width / 2, cy: height / 2, width, height, angle: 0 }, true)
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
  const full = Math.max(1, median(strongDistances.length ? strongDistances : [...ink.distances.values()]))
  for (const [p, d] of ink.distances) mask[p] = Math.max(1, Math.min(255, Math.round((255 * d) / full)))

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
