import { InferenceSession } from 'onnxruntime-node'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { containsPoint } from '../../src/ml/image/geometry'
import { parseCharacterDict } from '../../src/ml/pipelines/ocr/dict'
import { runOcr, type OcrLine } from '../../src/ml/pipelines/ocr/ocr'
import { inpaintTelea } from '../../src/ml/pipelines/inpaint/telea'
import { textMask } from '../../src/ml/pipelines/inpaint/text-mask'
import { ensureModelPack } from '../fixtures/models'
import { readPng } from '../fixtures/png'

/** Runs the real PP-OCRv5 models (downloaded once, SHA-256 verified) on a committed fixture. */
const poster = readPng('tests/fixtures/ocr-poster.png')
let lines: OcrLine[] = []

const colorDistance = (hex: string, rgb: [number, number, number]) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return Math.hypot((v[0] as number) - rgb[0], (v[1] as number) - rgb[1], (v[2] as number) - rgb[2])
}
const line = (text: string): OcrLine => {
  const found = lines.find((l) => l.text === text)
  if (!found) throw new Error(`Line "${text}" was not detected`)
  return found
}

beforeAll(async () => {
  const root = await ensureModelPack('ocr')
  const options = { executionProviders: ['cpu'], logSeverityLevel: 3 } as const
  const [det, rec] = await Promise.all([
    InferenceSession.create(join(root, 'ocr', 'det.onnx'), options),
    InferenceSession.create(join(root, 'ocr', 'rec.onnx'), options)
  ])
  const dict = parseCharacterDict(readFileSync(join(root, 'ocr', 'rec.yml'), 'utf8'))
  lines = await runOcr(
    poster,
    { det, rec, dict },
    { progress: () => undefined, checkCancelled: () => undefined }
  )
}, 120_000)

describe('OCR on real models', () => {
  it('reads every line of the poster exactly', () => {
    expect(lines.map((l) => l.text).sort()).toEqual(
      [
        'CallMissed Studio',
        'SUMMER SALE 50% OFF',
        'Visit us at 42 Market Street',
        'Fresh Coffee',
        'Open every day'
      ].sort()
    )
    for (const line of lines) expect(line.confidence).toBeGreaterThan(0.85)
  })

  it('locates lines where they were drawn', () => {
    expect(containsPoint(line('CallMissed Studio').rect, 250, 85)).toBe(true)
    expect(containsPoint(line('SUMMER SALE 50% OFF').rect, 450, 210)).toBe(true)
    expect(containsPoint(line('Open every day').rect, 300, 560)).toBe(true)
  })

  it('measures the rotation of tilted text', () => {
    // Drawn rotated 12° counter-clockwise, i.e. -12° in image coordinates.
    expect(line('Fresh Coffee').rect.angle).toBeGreaterThan(-12.5)
    expect(line('Fresh Coffee').rect.angle).toBeLessThan(-11.5)
    expect(Math.abs(line('CallMissed Studio').rect.angle)).toBeLessThan(1.5)
  })

  it('estimates text and background colors', () => {
    expect(colorDistance(line('CallMissed Studio').style.color, [20, 40, 90])).toBeLessThan(40)
    expect(colorDistance(line('SUMMER SALE 50% OFF').style.color, [255, 255, 255])).toBeLessThan(40)
    expect(colorDistance(line('SUMMER SALE 50% OFF').style.background, [220, 30, 45])).toBeLessThan(40)
    expect(colorDistance(line('Fresh Coffee').style.color, [120, 60, 20])).toBeLessThan(50)
  })

  it('tells bold text from regular by stroke width relative to ink height', () => {
    const ratio = (t: string) => {
      const l = line(t)
      return l.style.strokeWidth / (l.style.inkBottom - l.style.inkTop)
    }
    expect(ratio('SUMMER SALE 50% OFF')).toBeGreaterThan(ratio('CallMissed Studio') * 1.3)
  })

  it('erases text strokes so the area matches its background', () => {
    const target = line('CallMissed Studio')
    const mask = textMask(poster, [target.rect])
    const out = inpaintTelea(poster, mask.data)
    // Every pixel of the former text area is now close to the cream background.
    let worst = 0
    for (let y = 60; y < 110; y += 2) {
      for (let x = 70; x < 500; x += 2) {
        const i = (y * poster.width + x) * 4
        const d = Math.hypot(
          (out.data[i] as number) - 245,
          (out.data[i + 1] as number) - 243,
          (out.data[i + 2] as number) - 238
        )
        worst = Math.max(worst, d)
      }
    }
    expect(worst).toBeLessThan(30)
  })
})
