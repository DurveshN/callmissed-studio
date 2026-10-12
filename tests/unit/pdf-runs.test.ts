import { describe, expect, it } from 'vitest'
import {
  groupRuns,
  parsePdfFont,
  runBox,
  type TextRun
} from '../../src/renderer/src/features/text-detect/pdf-runs'

describe('PDF font names', () => {
  it('reads family, weight and italic from common naming schemes', () => {
    expect(parsePdfFont('ABCDEF+Calibri-Bold')).toEqual({ family: 'Calibri', weight: 700, italic: false })
    expect(parsePdfFont('TimesNewRomanPS-BoldItalicMT')).toEqual({
      family: 'Times New Roman',
      weight: 700,
      italic: true
    })
    expect(parsePdfFont('Arial,Italic')).toEqual({ family: 'Arial', weight: 400, italic: true })
    expect(parsePdfFont('ArialMT')).toEqual({ family: 'Arial', weight: 400, italic: false })
    expect(parsePdfFont('Montserrat-SemiBold')).toEqual({ family: 'Montserrat', weight: 600, italic: false })
    expect(parsePdfFont('Inter-Regular-1275')).toEqual({ family: 'Inter', weight: 400, italic: false })
    expect(parsePdfFont('SegoeUI-Light')).toEqual({ family: 'Segoe UI', weight: 300, italic: false })
  })

  it('falls back by kind for families the editor does not have', () => {
    expect(parsePdfFont('XYZABC+Garamond-Bold', { serif: true })).toEqual({
      family: 'Times New Roman',
      weight: 700,
      italic: false
    })
    expect(parsePdfFont('Menlo', { mono: true }).family).toBe('Courier New')
    expect(parsePdfFont('Helvetica').family).toBe('Arial')
  })
})

const run = (over: Partial<TextRun>): TextRun => ({
  text: 'x',
  x: 0,
  y: 100,
  angle: 0,
  size: 20,
  width: 50,
  font: 'f1',
  ascent: 0.9,
  descent: -0.2,
  ...over
})

describe('PDF text runs', () => {
  it('joins runs on one baseline, adding spaces only where the gap shows one', () => {
    const lines = groupRuns([
      run({ text: 'Hello', x: 0, width: 50 }),
      run({ text: 'world', x: 56, width: 50 }), // 6 px gap (0.3 em): a space
      run({ text: 's', x: 106, width: 8 }), // touching: same word
      run({ text: 'Next', x: 0, y: 130, width: 40 }) // new line below
    ])
    expect(lines.map((l) => l.text)).toEqual(['Hello worlds', 'Next'])
    expect(lines[0]?.width).toBeCloseTo(114)
  })

  it('keeps different fonts apart and skips empty runs', () => {
    const lines = groupRuns([
      run({ text: 'Bold', font: 'b' }),
      run({ text: ' ', x: 50 }),
      run({ text: 'plain', x: 56 })
    ])
    expect(lines.map((l) => l.text)).toEqual(['Bold', 'plain'])
  })

  it('boxes a line from its baseline, ascent and descent', () => {
    expect(runBox(run({ x: 10, y: 100, width: 80 }))).toEqual({
      cx: 50,
      cy: 93,
      width: 80,
      height: 22,
      angle: 0
    })
  })
})

describe('ink colour of a PDF line', () => {
  it('is the text colour, not the background', async () => {
    const { inkColor } = await import('../../src/renderer/src/features/text-detect/pdf-runs')
    const W = 100
    const H = 40
    const data = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < W * H; i++) data.set([250, 245, 235, 255], i * 4) // cream paper
    for (let y = 15; y < 25; y++) for (let x = 20; x < 80; x++) data.set([20, 40, 120, 255], (y * W + x) * 4) // navy ink
    expect(
      inkColor({ width: W, height: H, data }, { cx: 50, cy: 20, width: 90, height: 30, angle: 0 })
    ).toEqual({
      color: '#142878',
      background: '#faf5eb'
    })
  })
})
