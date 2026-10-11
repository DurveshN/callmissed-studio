import { describe, expect, it, vi } from 'vitest'
import { clusterMask, inpaintAuto, isFlatBackground } from '../../src/ml/pipelines/inpaint/auto'
import { createRgba, type Gray } from '../../src/ml/image/raster'

function maskWith(width: number, height: number, rects: [number, number, number, number][]): Gray {
  const m: Gray = { width, height, data: new Uint8Array(width * height) }
  for (const [x0, y0, x1, y1] of rects)
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m.data[y * width + x] = 255
  return m
}

describe('inpaint planning', () => {
  it('clusters nearby text and keeps distant text separate', () => {
    const mask = maskWith(1000, 400, [
      [10, 10, 60, 30],
      [70, 10, 120, 30], // near the first: same cluster
      [600, 300, 650, 320] // far away: own cluster
    ])
    expect(clusterMask(mask)).toHaveLength(2)
  })

  it('does not let clusters grow into page-sized regions', () => {
    // A column of lines 20 px apart spanning 900 px.
    const rects: [number, number, number, number][] = Array.from({ length: 30 }, (_, i) => [
      10,
      i * 30,
      200,
      i * 30 + 12
    ])
    const boxes = clusterMask(maskWith(400, 920, rects))
    for (const b of boxes) expect(Math.max(b.x1 - b.x0, b.y1 - b.y0)).toBeLessThanOrEqual(320)
  })

  it('recognizes flat and textured surroundings', () => {
    const flat = createRgba(60, 40)
    flat.data.fill(230)
    const mask = maskWith(60, 40, [[20, 15, 40, 25]])
    const box = { x0: 20, y0: 15, x1: 40, y1: 25 }
    expect(isFlatBackground(flat, mask, box)).toBe(true)
    const noisy = createRgba(60, 40)
    for (let i = 0; i < noisy.data.length; i++) noisy.data[i] = (i * 97) % 256
    expect(isFlatBackground(noisy, mask, box)).toBe(false)
  })

  it('uses the fast fill on flat backgrounds even when LaMa is available', async () => {
    const img = createRgba(80, 40)
    img.data.fill(200)
    const lama = vi.fn()
    const { usedLama, image } = await inpaintAuto(img, maskWith(80, 40, [[30, 10, 50, 20]]), lama, {
      progress: () => undefined,
      checkCancelled: () => undefined
    })
    expect(usedLama).toBe(false)
    expect(lama).not.toHaveBeenCalled()
    expect(new Set(image.data)).toEqual(new Set([200, 255]))
  })
})
