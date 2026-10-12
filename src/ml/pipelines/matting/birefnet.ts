import { createRgba, resizeSmooth } from '../../image/raster'

/** BiRefNet_lite works on a 1024×1024 stretch of the image and returns foreground logits. */
export const BIREFNET_SIZE = 1024

/** Foreground opacity (0..255) at width×height from the model's size×size logits. */
export function matteFromLogits(
  logits: Float32Array,
  size: number,
  width: number,
  height: number
): Uint8Array {
  const matte = createRgba(size, size)
  for (let i = 0; i < size * size; i++) {
    matte.data[i * 4] = Math.round(255 / (1 + Math.exp(-(logits[i] as number))))
  }
  const resized = resizeSmooth(matte, width, height)
  const alpha = new Uint8Array(width * height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = resized.data[i * 4] as number
  return alpha
}
