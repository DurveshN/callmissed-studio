import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InferenceSession } from 'onnxruntime-node'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CancelledError, JobQueue, throwIfCancelled } from '../../src/ml/job-queue'
import { ModelLoadError, ModelMissingError, SessionPool } from '../../src/ml/session-pool'
import { ModelManifest } from '../../src/shared/ml/models'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function modelsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'studio-pool-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'ocr'))
  writeFileSync(join(dir, 'ocr', 'det.onnx'), 'x')
  return dir
}

const fakeSession = () =>
  ({ release: vi.fn(async () => undefined), inputNames: [], outputNames: [] }) as unknown as InferenceSession

describe('SessionPool', () => {
  it('uses DirectML when it works and caches sessions', async () => {
    const create = vi.fn(async (_path: string, _options: InferenceSession.SessionOptions) => fakeSession())
    const pool = new SessionPool(create, vi.fn())
    pool.configure(modelsDir(), 'auto')
    const a = await pool.get('ocr', 'det.onnx')
    const b = await pool.get('ocr', 'det.onnx')
    expect(a).toBe(b)
    expect(a.provider).toBe('dml')
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[1].executionProviders).toEqual(['dml', 'cpu'])
  })

  it('falls back to CPU once DirectML fails and reports it', async () => {
    const create = vi.fn(async (_path: string, options: InferenceSession.SessionOptions) => {
      if (options.executionProviders?.includes('dml')) throw new Error('no adapter')
      return fakeSession()
    })
    const onGpuFailed = vi.fn()
    const pool = new SessionPool(create, onGpuFailed)
    pool.configure(modelsDir(), 'auto')
    expect((await pool.get('ocr', 'det.onnx')).provider).toBe('cpu')
    expect(onGpuFailed).toHaveBeenCalledWith('no adapter')
  })

  it('never tries DirectML when the GPU is turned off', async () => {
    const create = vi.fn(async (_path: string, _options: InferenceSession.SessionOptions) => fakeSession())
    const pool = new SessionPool(create, vi.fn())
    pool.configure(modelsDir(), 'off')
    expect((await pool.get('ocr', 'det.onnx')).provider).toBe('cpu')
    expect(create.mock.calls[0]?.[1].executionProviders).toEqual(['cpu'])
  })

  it('distinguishes missing files from files that fail to load', async () => {
    const pool = new SessionPool(async () => Promise.reject(new Error('bad protobuf')), vi.fn())
    pool.configure(modelsDir(), 'off')
    await expect(pool.get('ocr', 'nope.onnx')).rejects.toBeInstanceOf(ModelMissingError)
    await expect(pool.get('ocr', 'det.onnx')).rejects.toBeInstanceOf(ModelLoadError)
  })

  it('releases sessions of a model', async () => {
    const session = fakeSession()
    const pool = new SessionPool(async () => session, vi.fn())
    pool.configure(modelsDir(), 'off')
    await pool.get('ocr', 'det.onnx')
    await pool.release(['ocr'])
    expect(session.release).toHaveBeenCalled()
  })
})

describe('JobQueue', () => {
  it('runs jobs one at a time in order', async () => {
    const queue = new JobQueue()
    const log: string[] = []
    const job = (name: string) => async () => {
      log.push(`start ${name}`)
      await new Promise((r) => setTimeout(r, 5))
      log.push(`end ${name}`)
    }
    queue.enqueue(1, job('a'))
    queue.enqueue(2, job('b'))
    await vi.waitFor(() => expect(log).toHaveLength(4))
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b'])
  })

  it('cancels queued and running jobs', async () => {
    const queue = new JobQueue()
    const seen: string[] = []
    queue.enqueue(1, async (signal) => {
      await new Promise((r) => setTimeout(r, 20))
      try {
        throwIfCancelled(signal)
        seen.push('1 finished')
      } catch (e) {
        seen.push(e instanceof CancelledError ? '1 cancelled' : 'error')
      }
    })
    queue.enqueue(2, async (signal) => {
      seen.push(signal.aborted ? '2 cancelled' : '2 ran')
    })
    expect(queue.cancel(2)).toBe(true)
    expect(queue.cancel(1)).toBe(true)
    expect(queue.cancel(99)).toBe(false)
    await vi.waitFor(() => expect(seen).toHaveLength(2))
    expect(seen.sort()).toEqual(['1 cancelled', '2 cancelled'])
  })
})

describe('models.manifest.json', () => {
  const manifest = ModelManifest.parse(JSON.parse(readFileSync('resources/models.manifest.json', 'utf8')))

  it('pins every download to an immutable commit', () => {
    for (const file of manifest.packs.flatMap((p) => p.files)) {
      for (const url of file.urls) expect(url).toMatch(/\/resolve\/[0-9a-f]{40}\//)
    }
  })

  it('only lists permissively licensed models', () => {
    for (const pack of manifest.packs) expect(['Apache-2.0', 'MIT', 'BSD-3-Clause']).toContain(pack.license)
  })

  it('keeps ONNX external-data files next to their graph', () => {
    for (const pack of manifest.packs) {
      const names = pack.files.map((f) => f.name)
      for (const name of names.filter((n) => n.endsWith('.onnx_data'))) {
        expect(names).toContain(name.replace(/_data$/, ''))
      }
    }
  })
})

describe('SessionPool.run', () => {
  it('reloads a model on CPU and retries when it fails while running on DirectML', async () => {
    const created: string[] = []
    const create = vi.fn(async (_path: string, options: InferenceSession.SessionOptions) => {
      const provider = options.executionProviders?.includes('dml') ? 'dml' : 'cpu'
      created.push(provider)
      return { ...fakeSession(), provider } as unknown as InferenceSession
    })
    const pool = new SessionPool(create, vi.fn())
    pool.configure(modelsDir(), 'auto')
    const work = vi.fn(async (session: InferenceSession) => {
      if ((session as unknown as { provider: string }).provider === 'dml')
        throw new Error('80070057 The parameter is incorrect')
      return 42
    })
    expect(await pool.run('ocr', 'det.onnx', work)).toEqual({ result: 42, provider: 'cpu' })
    expect(created).toEqual(['dml', 'cpu'])
    // Stays on CPU afterwards: no new DirectML attempt.
    expect(await pool.run('ocr', 'det.onnx', work)).toEqual({ result: 42, provider: 'cpu' })
    expect(created).toEqual(['dml', 'cpu'])
  })

  it('does not retry failures that happen on CPU', async () => {
    const pool = new SessionPool(async () => fakeSession(), vi.fn())
    pool.configure(modelsDir(), 'off')
    await expect(pool.run('ocr', 'det.onnx', async () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom'
    )
  })
})

describe('SessionPool GPU memory', () => {
  it('reports a model that failed on DirectML and loads remembered ones on CPU directly', async () => {
    const providers: string[] = []
    const create = vi.fn(async (_path: string, options: InferenceSession.SessionOptions) => {
      providers.push(options.executionProviders?.includes('dml') ? 'dml' : 'cpu')
      return fakeSession()
    })
    const onCpuOnly = vi.fn()
    const dir = modelsDir()

    const first = new SessionPool(create, vi.fn(), onCpuOnly)
    await first.configure(dir, 'auto')
    await first.run('ocr', 'det.onnx', async () => {
      if (providers.at(-1) === 'dml') throw new Error('driver bug')
      return 1
    })
    expect(onCpuOnly).toHaveBeenCalledWith('ocr/det.onnx')

    providers.length = 0
    const next = new SessionPool(create, vi.fn())
    await next.configure(dir, 'auto', ['ocr/det.onnx'])
    expect((await next.get('ocr', 'det.onnx')).provider).toBe('cpu')
    expect(providers).toEqual(['cpu'])
  })
})

describe('SessionPool idle release', () => {
  function setup() {
    let now = 0
    const sessions: { release: ReturnType<typeof vi.fn> }[] = []
    const create = vi.fn(async () => {
      const session = { ...fakeSession(), release: vi.fn(async () => undefined) }
      sessions.push(session)
      return session as unknown as InferenceSession
    })
    const pool = new SessionPool(create, vi.fn(), undefined, { idleMs: 1000, now: () => now })
    pool.configure(modelsDir(), 'off')
    return { pool, create, sessions, advance: (ms: number) => (now += ms) }
  }

  it('unloads a model unused for the idle time, and reloads it on the next use', async () => {
    const { pool, create, sessions, advance } = setup()
    await pool.run('ocr', 'det.onnx', async () => 1)
    advance(999)
    await pool.releaseIdle()
    expect(sessions[0]?.release).not.toHaveBeenCalled()
    advance(1)
    await pool.releaseIdle()
    expect(sessions[0]?.release).toHaveBeenCalledTimes(1)
    await pool.run('ocr', 'det.onnx', async () => 1)
    expect(create).toHaveBeenCalledTimes(2)
    await pool.releaseAll()
  })

  it('never unloads a model while it is running', async () => {
    const { pool, sessions, advance } = setup()
    let finish: () => void = () => undefined
    const running = pool.run('ocr', 'det.onnx', () => new Promise<void>((resolve) => (finish = resolve)))
    await vi.waitFor(() => expect(sessions).toHaveLength(1))
    advance(5000)
    await pool.releaseIdle()
    expect(sessions[0]?.release).not.toHaveBeenCalled()
    finish()
    await running
    // Its idle time counts from when the run ended.
    advance(500)
    await pool.releaseIdle()
    expect(sessions[0]?.release).not.toHaveBeenCalled()
    await pool.releaseAll()
  })
})
