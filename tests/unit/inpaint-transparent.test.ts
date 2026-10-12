import { describe, expect, it } from 'vitest'
import { createRgba, type Gray } from '../../src/ml/image/raster'
import { inpaintTelea } from '../../src/ml/pipelines/inpaint/telea'
import { bleedColours, hasTransparency, inpaintTransparent } from '../../src/ml/pipelines/inpaint/transparent'

// 100×60: opaque red on the left half, fully transparent (stored as black) on the right.
const W = 100
const H = 60
function picture() {
  const img = createRgba(W, H)
  for (let y = 0; y < H; y++) for (let x = 0; x < 50; x++) img.data.set([220, 30, 30, 255], (y * W + x) * 4)
  return img
}
// A hole across the edge between the two halves.
const mask: Gray = { width: W, height: H, data: new Uint8Array(W * H) }
for (let y = 20; y < 40; y++) for (let x = 30; x < 70; x++) mask.data[y * W + x] = 255
const px = (data: Uint8Array, x: number, y: number) =>
  Array.from(data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4))
const telea = async (img: ReturnType<typeof createRgba>, m: Gray) => ({
  image: inpaintTelea(img, m.data),
  method: 'telea'
})

describe('filling images with transparency', () => {
  it('detects transparency and bleeds visible colours into transparent pixels', () => {
    expect(hasTransparency(picture())).toBe(true)
    const bled = bleedColours(picture())
    expect(px(bled.data, 90, 10)).toEqual([220, 30, 30, 0])
  })

  it('a plain fill pulls in the black of transparent pixels (the bug)', () => {
    const plain = inpaintTelea(picture(), mask.data)
    expect(px(plain.data, 49, 30)).toEqual([124, 17, 17, 255]) // opaque, darkened red
  })

  it('fills colour from visible pixels and keeps transparent areas transparent', async () => {
    const { image } = await inpaintTransparent(picture(), mask, telea)
    for (let y = 20; y < 40; y++) {
      for (let x = 30; x < 70; x++) {
        const [r, , , a] = px(image.data, x, y) as [number, number, number, number]
        // Never an opaque dark pixel.
        if (a > 128) expect(r).toBeGreaterThan(180)
      }
    }
    expect(px(image.data, 33, 30)).toEqual([220, 30, 30, 255]) // deep in the red side: red, opaque
    expect((px(image.data, 67, 30)[3] as number) < 40).toBe(true) // deep in the clear side: transparent
    expect(px(image.data, 90, 10)).toEqual([0, 0, 0, 0]) // untouched outside the hole
  })
})
