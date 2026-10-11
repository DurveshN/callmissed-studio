import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InferenceSession, Tensor } from 'onnxruntime-node'
import { expect, it } from 'vitest'
import { identityOnnx } from '../fixtures/onnx'

it('the hand-encoded ONNX fixture loads and runs in ONNX Runtime', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-onnx-'))
  try {
    const path = join(dir, 'identity.onnx')
    writeFileSync(path, identityOnnx())
    const session = await InferenceSession.create(path, { executionProviders: ['cpu'] })
    expect(session.inputNames).toEqual(['x'])
    const out = await session.run({ x: new Tensor('float32', Float32Array.of(4.5), [1]) })
    expect(Array.from(out['y']?.data as Float32Array)).toEqual([4.5])
    await session.release()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
