import type { Gray } from './raster'

/** Square dilation of a 0/255 mask by `radius` pixels (separable max filter). */
export function dilate(mask: Gray, radius: number): Gray {
  if (radius <= 0) return { ...mask, data: mask.data.slice() }
  const { width, height } = mask
  const tmp = new Uint8Array(width * height)
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0
      for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius) && !v; k++)
        v = mask.data[y * width + k] as number
      tmp[y * width + x] = v ? 255 : 0
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0
      for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius) && !v; k++)
        v = tmp[k * width + x] as number
      out[y * width + x] = v ? 255 : 0
    }
  }
  return { width, height, data: out }
}

/** Box blur of a single channel (used to feather mask edges into 0..255 alpha). */
export function boxBlur(mask: Gray, radius: number): Gray {
  if (radius <= 0) return { ...mask, data: mask.data.slice() }
  const { width, height } = mask
  const pass = (src: Uint8Array, horizontal: boolean) => {
    const dst = new Uint8Array(width * height)
    const len = horizontal ? width : height
    const lines = horizontal ? height : width
    for (let line = 0; line < lines; line++) {
      const at = (i: number) => (horizontal ? line * width + i : i * width + line)
      let sum = 0
      for (let i = -radius; i <= radius; i++) sum += src[at(Math.min(len - 1, Math.max(0, i)))] as number
      for (let i = 0; i < len; i++) {
        dst[at(i)] = Math.round(sum / (2 * radius + 1))
        sum +=
          (src[at(Math.min(len - 1, i + radius + 1))] as number) -
          (src[at(Math.max(0, i - radius))] as number)
      }
    }
    return dst
  }
  return { width, height, data: pass(pass(mask.data, true), false) }
}

/** Otsu threshold of an 8-bit histogram. */
export function otsu(values: Uint8Array | number[]): number {
  const hist = new Array<number>(256).fill(0)
  for (const v of values) {
    const bin = Math.min(255, Math.max(0, Math.round(v)))
    hist[bin] = (hist[bin] as number) + 1
  }
  const total = values.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * (hist[i] as number)
  let sumB = 0
  let weightB = 0
  let best = 0
  let threshold = 127
  for (let t = 0; t < 256; t++) {
    weightB += hist[t] as number
    if (weightB === 0) continue
    const weightF = total - weightB
    if (weightF === 0) break
    sumB += t * (hist[t] as number)
    const meanB = sumB / weightB
    const meanF = (sum - sumB) / weightF
    const between = weightB * weightF * (meanB - meanF) ** 2
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}
