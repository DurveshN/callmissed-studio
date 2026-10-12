import { createRgba, type Gray, type Rgba } from '../../image/raster'
import { inpaintTelea } from './telea'

/** Below this opacity a pixel's colour is meaningless (often stored as black). */
const CLEAR = 8

export function hasTransparency(img: Rgba): boolean {
  for (let i = 3; i < img.data.length; i += 4) if ((img.data[i] as number) < 255) return true
  return false
}

/**
 * Copies the colour of the nearest visible pixel into (nearly) transparent ones, so fills don't pull
 * in the black that transparent pixels usually store. Opacity is untouched.
 */
export function bleedColours(img: Rgba): Rgba {
  const { width, height } = img
  const n = width * height
  const data = img.data.slice()
  const done = new Uint8Array(n)
  const queue = new Int32Array(n)
  let tail = 0
  for (let i = 0; i < n; i++) {
    if ((data[i * 4 + 3] as number) >= CLEAR) {
      done[i] = 1
      queue[tail++] = i
    }
  }
  // Breadth-first from all visible pixels: each transparent pixel takes its nearest one's colour.
  for (let head = 0; head < tail; head++) {
    const i = queue[head] as number
    const x = i % width
    const y = (i - x) / width
    const visit = (j: number) => {
      if (done[j]) return
      done[j] = 1
      data.copyWithin(j * 4, i * 4, i * 4 + 3)
      queue[tail++] = j
    }
    if (x > 0) visit(i - 1)
    if (x < width - 1) visit(i + 1)
    if (y > 0) visit(i - width)
    if (y < height - 1) visit(i + width)
  }
  return { width, height, data }
}

/**
 * Fills `mask` in an image with transparency: colours come from `fill` run on the image with
 * transparent colours bled from their visible neighbours; the opacity of the hole is filled from the
 * opacity around it, so a hole beside a transparent area stays (partly) transparent. Pixels outside
 * the hole keep their opacity, and fully transparent ones are left exactly as they were.
 */
export async function inpaintTransparent<M>(
  img: Rgba,
  mask: Gray,
  fill: (img: Rgba, mask: Gray) => Promise<{ image: Rgba; method: M }>
): Promise<{ image: Rgba; method: M }> {
  const { image: colour, method } = await fill(bleedColours(img), mask)
  const opacity = createRgba(img.width, img.height)
  for (let i = 0; i < img.width * img.height; i++) {
    opacity.data[i * 4] = img.data[i * 4 + 3] as number
  }
  const filledOpacity = inpaintTelea(opacity, mask.data)
  const out = img.data.slice()
  for (let i = 0; i < img.width * img.height; i++) {
    const o = i * 4
    if (mask.data[i]) {
      out.set(colour.data.subarray(o, o + 3), o)
      out[o + 3] = filledOpacity.data[o] as number
    } else if ((img.data[o + 3] as number) >= CLEAR) {
      // Visible pixels next to the hole may be blended by LaMa's feathered edge.
      out.set(colour.data.subarray(o, o + 3), o)
    }
  }
  return { image: { width: img.width, height: img.height, data: out }, method }
}
