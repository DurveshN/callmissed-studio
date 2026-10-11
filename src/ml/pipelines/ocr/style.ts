import { otsu } from '../../image/morphology'
import { toHex, type Gray, type Rgba } from '../../image/raster'

export interface LineStyle {
  color: string
  background: string
  /** Vertical extent of ink inside the crop (pixels from the crop top). */
  inkTop: number
  inkBottom: number
  /** Average stroke thickness in crop pixels. */
  strokeWidth: number
  /** Text pixels of the crop (255 = ink). */
  mask: Gray
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] as number
}

/**
 * Estimates text color, background color, ink extent and stroke width of an upright line crop.
 * Background = median of the crop border; ink = pixels whose color distance from it is above Otsu.
 */
export function estimateStyle(crop: Rgba): LineStyle {
  const { width, height, data } = crop
  const border: [number[], number[], number[]] = [[], [], []]
  const ring = Math.max(1, Math.round(height * 0.06))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= ring && x < width - ring && y >= ring && y < height - ring) continue
      const i = (y * width + x) * 4
      border[0].push(data[i] as number)
      border[1].push(data[i + 1] as number)
      border[2].push(data[i + 2] as number)
    }
  }
  const bg = border.map(median) as [number, number, number]

  const distance = new Uint8Array(width * height)
  for (let p = 0; p < distance.length; p++) {
    const i = p * 4
    const d = Math.hypot(
      (data[i] as number) - bg[0],
      (data[i + 1] as number) - bg[1],
      (data[i + 2] as number) - bg[2]
    )
    distance[p] = Math.min(255, Math.round(d / Math.sqrt(3)))
  }
  const threshold = Math.max(24, otsu(distance))

  const mask = new Uint8Array(width * height)
  const strong: [number[], number[], number[]] = [[], [], []]
  const strongCut = Math.min(255, threshold + (255 - threshold) * 0.35)
  let area = 0
  for (let p = 0; p < mask.length; p++) {
    if ((distance[p] as number) <= threshold) continue
    mask[p] = 255
    area++
    if ((distance[p] as number) >= strongCut) {
      strong[0].push(data[p * 4] as number)
      strong[1].push(data[p * 4 + 1] as number)
      strong[2].push(data[p * 4 + 2] as number)
    }
  }
  // Anti-aliased edges blend toward the background, so the core of the strokes defines the color.
  const ink = (strong[0].length ? strong : collect(data, mask)).map(median) as [number, number, number]

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
    color: toHex(...ink),
    background: toHex(...bg),
    inkTop,
    inkBottom,
    // For strokes of thickness s and total length L: area ≈ s·L and perimeter ≈ 2L.
    strokeWidth: perimeter ? (2 * area) / perimeter : 0,
    mask: { width, height, data: mask }
  }
}

function collect(data: Uint8Array, mask: Uint8Array): [number[], number[], number[]] {
  const out: [number[], number[], number[]] = [[], [], []]
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue
    out[0].push(data[p * 4] as number)
    out[1].push(data[p * 4 + 1] as number)
    out[2].push(data[p * 4 + 2] as number)
  }
  return out
}
