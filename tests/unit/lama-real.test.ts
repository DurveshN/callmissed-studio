import { InferenceSession } from 'onnxruntime-node'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inpaintAuto } from '../../src/ml/pipelines/inpaint/auto'
import { inpaintLama, lamaInfer } from '../../src/ml/pipelines/inpaint/lama'
import { createRgba } from '../../src/ml/image/raster'
import { textMask } from '../../src/ml/pipelines/inpaint/text-mask'
import { ensureModelPack } from '../fixtures/models'
import { readPng } from '../fixtures/png'

/**
 * Runs the real LaMa model (208 MB, cached in .cache/models after the first download).
 * Opt-in because of the download size: STUDIO_TEST_HEAVY=1 npm test
 */
describe.runIf(process.env['STUDIO_TEST_HEAVY'] === '1')('LaMa inpainting on the real model', () => {
  it('erases white text on a gradient so the area blends with its surroundings', async () => {
    const root = await ensureModelPack('inpaint')
    const session = await InferenceSession.create(join(root, 'inpaint', 'lama_fp32.onnx'), {
      executionProviders: ['cpu'],
      logSeverityLevel: 3
    })
    const poster = readPng('tests/fixtures/ocr-poster.png')
    // "Open every day": white bold text on the blue-purple gradient.
    const rect = { cx: 319, cy: 561.5, width: 489, height: 78.6, angle: 0 }
    const out = await inpaintLama(lamaInfer(session), poster, textMask(poster, [rect]))

    // No white (text) pixels remain, and each erased pixel is close to the gradient just below the text.
    let worst = 0
    for (let y = 535; y < 590; y += 2) {
      for (let x = 90; x < 540; x += 3) {
        const i = (y * poster.width + x) * 4
        const ref = (620 * poster.width + x) * 4
        const d = Math.hypot(
          (out.data[i] as number) - (poster.data[ref] as number),
          (out.data[i + 1] as number) - (poster.data[ref + 1] as number),
          (out.data[i + 2] as number) - (poster.data[ref + 2] as number)
        )
        worst = Math.max(worst, d)
      }
    }
    expect(worst).toBeLessThan(45)
    await session.release()
  }, 180_000)

  it('fills a large removed object from its surroundings, never dark', async () => {
    // A 1200 px object on a textured 2000×1600 picture: deeper than one tile, so it must not be tiled.
    const root = await ensureModelPack('inpaint')
    const session = await InferenceSession.create(join(root, 'inpaint', 'lama_fp32.onnx'), {
      executionProviders: ['cpu'],
      logSeverityLevel: 3
    })
    const W = 2000
    const H = 1600
    const img = createRgba(W, H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        img.data.set([120 + 60 * Math.sin(x / 15), 160 + 40 * Math.cos(y / 11), 90, 255], (y * W + x) * 4)
      }
    }
    const mask = { width: W, height: H, data: new Uint8Array(W * H) }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) if ((x - 1000) ** 2 + (y - 800) ** 2 < 600 ** 2) mask.data[y * W + x] = 255
    }
    const { image, usedLama } = await inpaintAuto(img, mask, lamaInfer(session), {
      progress: () => undefined,
      checkCancelled: () => undefined
    })
    expect(usedLama).toBe(true)
    let dark = 0
    let filled = 0
    for (let y = 250; y < 1350; y += 9) {
      for (let x = 450; x < 1550; x += 9) {
        if (!mask.data[y * W + x]) continue
        filled++
        const i = (y * W + x) * 4
        if ((image.data[i] as number) + (image.data[i + 1] as number) < 120) dark++
      }
    }
    expect(dark / filled).toBeLessThan(0.002)
    await session.release()
  }, 300_000)
})
