import { describe, expect, it, vi } from 'vitest'
import { clusterMask, holeDepth, inpaintAuto, isFlatBackground } from '../../src/ml/pipelines/inpaint/auto'
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

  it('tiles one long line and does not let it absorb the lines below', () => {
    // A 1000 px line with short lines 20 px below each other under it.
    const rects: [number, number, number, number][] = [[0, 0, 1000, 20]]
    for (let i = 1; i < 30; i++) rects.push([0, i * 30, 200, i * 30 + 12])
    const boxes = clusterMask(maskWith(1000, 920, rects))
    for (const b of boxes) expect(Math.max(b.x1 - b.x0, b.y1 - b.y0)).toBeLessThanOrEqual(320)
    // The line's tiles cover it exactly.
    const lineTiles = boxes.filter((b) => b.y0 === 0)
    expect(lineTiles.reduce((sum, b) => sum + b.x1 - b.x0, 0)).toBe(1000)
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

  it('hides text of neighbouring clusters from LaMa (no ghost letters copied into the fill)', async () => {
    // A 700 px line split into clusters (MAX_CLUSTER_SIDE) on a textured background.
    const img = createRgba(800, 60)
    for (let i = 0; i < img.data.length; i++) img.data[i] = i % 4 === 3 ? 255 : (i * 97) % 256
    const mask = maskWith(800, 60, [
      [50, 20, 300, 40],
      [310, 20, 560, 40],
      [570, 20, 750, 40]
    ])
    expect(clusterMask(mask).length).toBeGreaterThan(1)
    const seen: Float32Array[] = []
    const lama = vi.fn(async (image: Float32Array, m: Float32Array) => {
      seen.push(m)
      return new Float32Array(image.length).fill(128)
    })
    await inpaintAuto(img, mask, lama, { progress: () => undefined, checkCancelled: () => undefined })
    // Every masked pixel inside a context crop is a hole for the model, not just its own cluster's:
    // a cluster alone covers ≤ 62.5% of its crop's width (context = 1.6×), its neighbours fill the rest.
    expect(seen.length).toBeGreaterThan(1)
    for (const m of seen) {
      let widest = 0
      for (let y = 0; y < 512; y++) {
        let holes = 0
        for (let x = 0; x < 512; x++) holes += m[y * 512 + x] as number
        widest = Math.max(widest, holes)
      }
      expect(widest / 512).toBeGreaterThan(0.75)
    }
  })

  it('measures how deep a hole is', () => {
    const line = maskWith(200, 100, [[10, 40, 190, 60]])
    expect(holeDepth(line, { x0: 0, y0: 0, x1: 200, y1: 100 })).toBe(10)
    const block = maskWith(200, 200, [[0, 0, 200, 200]])
    expect(holeDepth(block, { x0: 0, y0: 0, x1: 200, y1: 200 })).toBe(100)
  })

  it('keeps a large removed object whole instead of tiling it', () => {
    const W = 1000
    const blob = maskWith(W, W, [[100, 100, 900, 900]])
    expect(clusterMask(blob)).toEqual([{ x0: 100, y0: 100, x1: 900, y1: 900 }])
  })
})
