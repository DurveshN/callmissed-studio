import { describe, expect, it } from 'vitest'
import { selectMask, type SamPrompt } from '../../src/ml/pipelines/segment/sam'
import { createRgba, resizeSmooth } from '../../src/ml/image/raster'

/** The value, failing the test when it is missing. */
function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a value')
  return value
}

const LOW = 64

/** Three candidate masks of LOW×LOW logits: +5 where `inside(x, y)` holds for that candidate, else −5. */
function logits(...candidates: ((x: number, y: number) => boolean)[]): Float32Array {
  const out = new Float32Array(3 * LOW * LOW).fill(-5)
  candidates.forEach((inside, k) => {
    for (let y = 0; y < LOW; y++)
      for (let x = 0; x < LOW; x++) if (inside(x, y)) out[k * LOW * LOW + y * LOW + x] = 5
  })
  return out
}
const dims = [1, 1, 3, LOW, LOW]
const none = () => false
const square = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) =>
  x >= x0 && x < x1 && y >= y0 && y < y1
const at = (mask: NonNullable<ReturnType<typeof selectMask>['mask']>, x: number, y: number) =>
  x >= mask.x && y >= mask.y && x < mask.x + mask.width && y < mask.y + mask.height
    ? mask.data[(y - mask.y) * mask.width + x - mask.x]
    : 0

describe('SAM mask selection', () => {
  it('uses the best-rated candidate, upsampled into image coordinates', () => {
    // Candidate 1 (best) covers low-res cells 8..24 → image pixels 32..96 at 4× scale.
    const { mask, score } = selectMask(
      logits(square(0, 0, 4, 4), square(8, 8, 24, 24), none),
      dims,
      Float32Array.from([0.2, 0.9, 0.1]),
      256,
      256,
      { points: [{ x: 60, y: 60, label: 1 }] }
    )
    expect(score).toBeCloseTo(0.9)
    expect(mask).not.toBeNull()
    expect(Math.abs(present(mask).x - 32)).toBeLessThanOrEqual(2)
    expect(Math.abs(present(mask).x + present(mask).width - 96)).toBeLessThanOrEqual(2)
    expect(at(present(mask), 60, 60)).toBe(255)
    expect(at(present(mask), 10, 10)).toBe(0)
  })

  it('keeps only the parts that were clicked', () => {
    const twoBlobs = (x: number, y: number) => square(4, 4, 14, 14)(x, y) || square(40, 40, 50, 50)(x, y)
    const prompt: SamPrompt = { points: [{ x: 180, y: 180, label: 1 }] }
    const { mask } = selectMask(
      logits(twoBlobs, none, none),
      dims,
      Float32Array.from([1, 0, 0]),
      256,
      256,
      prompt
    )
    expect(at(present(mask), 180, 180)).toBe(255)
    expect(at(present(mask), 36, 36)).toBe(0)
  })

  it('drops specks from a box selection but keeps every substantial part', () => {
    const parts = (x: number, y: number) =>
      square(4, 4, 20, 20)(x, y) || square(30, 4, 46, 20)(x, y) || (x === 60 && y === 60)
    const { mask } = selectMask(logits(parts, none, none), dims, Float32Array.from([1, 0, 0]), 256, 256, {
      points: [],
      box: { x0: 0, y0: 0, x1: 256, y1: 256 }
    })
    expect(at(present(mask), 40, 40)).toBe(255)
    expect(at(present(mask), 150, 40)).toBe(255)
    expect(at(present(mask), 242, 242)).toBe(0)
  })

  it('fills small holes but keeps large ones', () => {
    const ringWithPinhole = (x: number, y: number) =>
      square(4, 4, 60, 60)(x, y) && !square(28, 28, 36, 36)(x, y) && !(x === 10 && y === 10)
    const { mask } = selectMask(
      logits(ringWithPinhole, none, none),
      dims,
      Float32Array.from([1, 0, 0]),
      256,
      256,
      { points: [{ x: 30, y: 30, label: 1 }] }
    )
    expect(at(present(mask), 42, 42)).toBe(255) // pinhole filled
    expect(at(present(mask), 128, 128)).toBe(0) // 32×32 px hole kept
  })

  it('returns no mask when nothing is selected', () => {
    expect(
      selectMask(logits(none, none, none), dims, Float32Array.from([1, 0, 0]), 100, 100, {
        points: [{ x: 5, y: 5, label: 1 }]
      }).mask
    ).toBeNull()
  })
})

describe('smooth resize', () => {
  it('averages every covered pixel when shrinking', () => {
    const src = createRgba(4, 1)
    ;[0, 255, 0, 255].forEach((v, i) => src.data.set([v, v, v, 255], i * 4))
    const out = resizeSmooth(src, 1, 1)
    expect(Math.abs((out.data[0] as number) - 128)).toBeLessThanOrEqual(1)
  })

  it('keeps an image unchanged at the same size', () => {
    const src = createRgba(3, 2)
    for (let i = 0; i < src.data.length; i++) src.data[i] = (i * 37) % 256
    expect(resizeSmooth(src, 3, 2).data).toEqual(src.data)
  })
})
