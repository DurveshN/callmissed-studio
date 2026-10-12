import { InferenceSession } from 'onnxruntime-node'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inpaintLama, lamaInfer } from '../../src/ml/pipelines/inpaint/lama'
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
})
