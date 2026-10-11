import { describe, expect, it } from 'vitest'
import {
  connectedComponents,
  containsPoint,
  minAreaRect,
  rectCorners,
  unclip
} from '../../src/ml/image/geometry'
import { dilate, otsu } from '../../src/ml/image/morphology'
import { createRgba, resize, warpQuad } from '../../src/ml/image/raster'
import { parseCharacterDict } from '../../src/ml/pipelines/ocr/dict'
import { groupLines } from '../../src/ml/pipelines/ocr/lines'
import { ctcDecode } from '../../src/ml/pipelines/ocr/rec'
import { inpaintTelea } from '../../src/ml/pipelines/inpaint/telea'

describe('geometry', () => {
  it('finds 4-connected components', () => {
    // prettier-ignore
    const mask = Uint8Array.from([
      1, 1, 0, 0,
      0, 1, 0, 1,
      0, 0, 0, 1
    ])
    const parts = connectedComponents(mask, 4, 3)
    expect(parts.map((p) => p.pixels.length)).toEqual([3, 2])
  })

  it('fits an axis-aligned rectangle exactly (whole pixels)', () => {
    const points = []
    for (let y = 10; y < 20; y++) for (let x = 5; x < 45; x++) points.push({ x, y })
    expect(minAreaRect(points)).toMatchObject({ cx: 25, cy: 15, width: 40, height: 10, angle: 0 })
  })

  it('fits a rotated rectangle and reports its angle', () => {
    const rect = { cx: 100, cy: 80, width: 120, height: 20, angle: 30 }
    const points = []
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 200; x++) if (containsPoint(rect, x + 0.5, y + 0.5)) points.push({ x, y })
    const fit = minAreaRect(points)
    expect(fit.angle).toBeCloseTo(30, 0)
    expect(fit.width).toBeCloseTo(120, -1)
    expect(fit.height).toBeCloseTo(20, -1)
  })

  it('unclips by area × ratio / perimeter on each side', () => {
    expect(unclip({ cx: 0, cy: 0, width: 40, height: 10, angle: 0 }, 1.5)).toMatchObject({
      width: 52,
      height: 22
    })
  })

  it('returns corners in reading order', () => {
    const [tl, tr, br, bl] = rectCorners({ cx: 10, cy: 5, width: 20, height: 10, angle: 0 })
    expect([tl, tr, br, bl]).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 }
    ])
  })
})

describe('raster helpers', () => {
  it('resizes a uniform image without changing its color', () => {
    const img = createRgba(10, 10)
    img.data.fill(200)
    expect(new Set(resize(img, 37, 5).data)).toEqual(new Set([200]))
  })

  it('warps a quad into an upright crop', () => {
    const img = createRgba(4, 4)
    for (let i = 0; i < 16; i++) img.data.set([i * 10, 0, 0, 255], i * 4)
    const crop = warpQuad(img, rectCorners({ cx: 2, cy: 2, width: 2, height: 2, angle: 0 }), 2, 2)
    expect(Array.from(crop.data.filter((_, i) => i % 4 === 0))).toEqual([50, 60, 90, 100])
  })

  it('dilates masks and computes Otsu thresholds', () => {
    const mask = { width: 5, height: 1, data: Uint8Array.from([0, 0, 255, 0, 0]) }
    expect(Array.from(dilate(mask, 1).data)).toEqual([0, 255, 255, 255, 0])
    const t = otsu([...Array(50).fill(20), ...Array(50).fill(200)])
    expect(t).toBeGreaterThanOrEqual(20)
    expect(t).toBeLessThan(200)
  })
})

describe('recognition decoding', () => {
  it('parses plain and quoted dictionary entries', () => {
    const yaml =
      "PostProcess:\n  name: CTCLabelDecode\n  character_dict:\n  - a\n  - ''''\n  - '#'\n  - 中\nOther: 1\n"
    expect(parseCharacterDict(yaml)).toEqual(['a', "'", '#', '中'])
  })

  it('collapses repeats, drops blanks and maps the last class to a space', () => {
    const dict = ['H', 'i']
    // classes: 0 blank, 1 'H', 2 'i', 3 ' '
    const steps = [1, 1, 0, 2, 3, 0, 1]
    const probs = new Float32Array(steps.length * 4)
    steps.forEach((c, t) => (probs[t * 4 + c] = 0.9))
    expect(ctcDecode(probs, [1, steps.length, 4], dict)[0]).toMatchObject({ text: 'Hi H' })
  })
})

describe('line grouping', () => {
  const word = (text: string, cx: number, cy: number, width: number, height = 20, angle = 0) => ({
    text,
    confidence: 0.9,
    rect: { cx, cy, width, height, angle }
  })

  it('joins words on one baseline and keeps separate lines apart', () => {
    const lines = groupLines([
      word('Studio', 160, 50, 80),
      word('CallMissed', 50, 50, 110),
      word('Second', 60, 120, 90)
    ])
    expect(lines.map((l) => l.text)).toEqual(['CallMissed Studio', 'Second'])
  })

  it('does not join words separated by a wide gap or of very different size', () => {
    expect(groupLines([word('Left', 50, 50, 60), word('Right', 400, 50, 60)])).toHaveLength(2)
    expect(groupLines([word('Big', 50, 50, 60, 60), word('small', 120, 50, 40, 15)])).toHaveLength(2)
  })
})

describe('Telea inpainting', () => {
  it('fills a hole from its surroundings and leaves other pixels untouched', () => {
    const img = createRgba(20, 20)
    for (let i = 0; i < 400; i++) img.data.set([30, 120, 200, 255], i * 4)
    const mask = new Uint8Array(400)
    for (let y = 8; y < 12; y++)
      for (let x = 5; x < 15; x++) {
        mask[y * 20 + x] = 255
        img.data.set([255, 255, 255, 255], (y * 20 + x) * 4)
      }
    const out = inpaintTelea(img, mask)
    for (let i = 0; i < 400; i++)
      expect(Array.from(out.data.subarray(i * 4, i * 4 + 3))).toEqual([30, 120, 200])
  })
})
