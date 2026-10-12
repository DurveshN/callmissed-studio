import type { Adjustments } from '@shared/document/model'

export const NEUTRAL: Adjustments = { brightness: 0, contrast: 0, saturation: 0 }

export const isNeutral = (a: Adjustments | undefined): boolean =>
  !a || (a.brightness === 0 && a.contrast === 0 && a.saturation === 0)

/**
 * Applies adjustments to RGBA pixels in place: brightness shifts every channel (±255 at ±1),
 * contrast scales around mid-grey (×0 at −1, ×20 near +1), saturation scales the distance from each
 * pixel's luma (greyscale at −1, double at +1). Alpha is untouched.
 */
export function adjustPixels(data: Uint8ClampedArray, a: Adjustments): void {
  const shift = a.brightness * 255
  const gain = a.contrast >= 0 ? 1 / Math.max(0.05, 1 - a.contrast) : 1 + a.contrast
  const colorfulness = 1 + a.saturation
  for (let i = 0; i < data.length; i += 4) {
    let r = ((data[i] as number) + shift - 128) * gain + 128
    let g = ((data[i + 1] as number) + shift - 128) * gain + 128
    let b = ((data[i + 2] as number) + shift - 128) * gain + 128
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    r = luma + (r - luma) * colorfulness
    g = luma + (g - luma) * colorfulness
    b = luma + (b - luma) * colorfulness
    // Uint8ClampedArray rounds and clamps on assignment.
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }
}
