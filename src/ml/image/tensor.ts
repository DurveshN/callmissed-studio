import { resizeSmooth, type Rgba } from './raster'

const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const
const IMAGENET_STD = [0.229, 0.224, 0.225] as const

/**
 * NCHW float tensor of `src` stretched to size×size, RGB scaled to 0..1 and ImageNet-normalized
 * (the preprocessing of SAM 2.1 and BiRefNet: resize without keeping aspect, rescale 1/255, normalize).
 * Transparent pixels are seen over white, as on the page.
 */
export function imagenetTensor(src: Rgba, size: number): Float32Array {
  const resized = resizeSmooth(src, size, size)
  const plane = size * size
  const out = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    const alpha = (resized.data[i * 4 + 3] as number) / 255
    for (let c = 0; c < 3; c++) {
      const value = ((resized.data[i * 4 + c] as number) / 255) * alpha + (1 - alpha)
      out[c * plane + i] = (value - (IMAGENET_MEAN[c] as number)) / (IMAGENET_STD[c] as number)
    }
  }
  return out
}
