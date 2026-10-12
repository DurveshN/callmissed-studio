import { describe, expect, it } from 'vitest'
import { viewToPdf, type Matrix } from '../../src/shared/pdf/view-matrix'

const apply = ([a, b, c, d, e, f]: Matrix, x: number, y: number) => [a * x + c * y + e, b * x + d * y + f]

describe('view space → PDF user space', () => {
  it('is a plain flip-free identity for an unrotated page at the origin', () => {
    // pdf.js viewport for a 400×300 page: (x, y) ↦ (x, 300 − y).
    const m = viewToPdf([1, 0, 0, -1, 0, 300], 300)
    expect(apply(m, 10, 20)).toEqual([10, 20])
  })

  it('undoes /Rotate 90: the view’s bottom-left is the page’s top-left corner', () => {
    // pdf.js viewport of a 400×300 page turned 90°: (x, y) ↦ (y, x); displayed 300 × 400.
    const m = viewToPdf([0, 1, 1, 0, 0, 0], 400)
    expect(apply(m, 0, 0).map((v) => v + 0)).toEqual([400, 0])
    expect(apply(m, 300, 400).map((v) => v + 0)).toEqual([0, 300])
  })

  it('accounts for a crop box that does not start at the origin', () => {
    // Crop box from (50, 60): pdf.js viewport (x, y) ↦ (x − 50, 360 − y) for a 300-high box.
    const m = viewToPdf([1, 0, 0, -1, -50, 360], 300)
    expect(apply(m, 0, 0)).toEqual([50, 60])
  })
})
