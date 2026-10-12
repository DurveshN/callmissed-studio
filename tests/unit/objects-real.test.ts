import { InferenceSession } from 'onnxruntime-node'
import { describe, expect, it } from 'vitest'
import { removeBg } from '../../src/ml/handlers/remove-bg'
import { NotPreparedError, segment, segmentPrepare } from '../../src/ml/handlers/segment'
import { SessionPool } from '../../src/ml/session-pool'
import { ensureModelPack } from '../fixtures/models'

/** The value, failing the test when it is missing. */
function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a value')
  return value
}

/**
 * Runs the real SAM 2.1 tiny (156 MB) and BiRefNet_lite (224 MB) models through the worker handlers,
 * cached in .cache/models after the first download. Opt-in: STUDIO_TEST_HEAVY=1 npm test
 */
// 400×300 white image: red disc (r = 60) at (120, 150), blue square 260..360 × 100..200.
const W = 400
const H = 300
const pixels = new Uint8Array(W * H * 4).fill(255)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    if ((x - 120) ** 2 + (y - 150) ** 2 < 3600) pixels.set([255, 30, 30], i)
    if (x >= 260 && x < 360 && y >= 100 && y < 200) pixels.set([30, 60, 255], i)
  }
}
const image = { width: W, height: H, pixels }

async function context() {
  const pool = new SessionPool(
    (path, options) => InferenceSession.create(path, options),
    () => undefined
  )
  await pool.configure(await ensureModelPack('segment'), 'off')
  await ensureModelPack('remove-bg')
  return { pool, packs: [], signal: new AbortController().signal, progress: () => undefined }
}

describe.runIf(process.env['STUDIO_TEST_HEAVY'] === '1')('object tools on the real models', () => {
  it('selects the clicked object, and a boxed one', async () => {
    const ctx = await context()
    await expect(segment({ key: 'test', points: [{ x: 1, y: 1, label: 1 }] }, ctx)).rejects.toThrow(
      NotPreparedError
    )
    await segmentPrepare({ key: 'test', ...image }, ctx)
    const disc = await segment({ key: 'test', points: [{ x: 120, y: 150, label: 1 }] }, ctx)
    const area = present(disc.mask).data.filter((v) => v).length
    expect(Math.abs(area - Math.PI * 3600) / (Math.PI * 3600)).toBeLessThan(0.05)
    expect(disc.mask).toMatchObject({ x: 61, y: 91, width: 119, height: 119 })

    const boxed = await segment({ key: 'test', points: [], box: { x0: 250, y0: 90, x1: 370, y1: 210 } }, ctx)
    expect(boxed.mask).toMatchObject({ x: 260, y: 100, width: 100, height: 100 })
    await ctx.pool.releaseAll()
  }, 300_000)

  it('separates the objects from the background', async () => {
    const ctx = await context()
    const { alpha } = await removeBg(image, ctx)
    expect(alpha).toHaveLength(W * H)
    expect(alpha[150 * W + 120]).toBeGreaterThan(200) // disc
    expect(alpha[150 * W + 310]).toBeGreaterThan(200) // square
    expect(alpha[20 * W + 20]).toBeLessThan(30) // background
    await ctx.pool.releaseAll()
  }, 300_000)
})
