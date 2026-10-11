import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ModelManager } from '../../src/main/services/model-manager'
import type { ModelManifest, ModelStatus } from '../../src/shared/ml/models'

const payload = randomBytes(256 * 1024)
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

interface ServerControl {
  /** Close the connection after this many body bytes on the next non-range request (simulates a drop). */
  dropAfter: number | null
  /** Ignore Range headers (respond 200 with the full body). */
  ignoreRange: boolean
  /** Serve corrupted bytes. */
  corrupt: boolean
  requests: { range: string | undefined }[]
}

let dir: string
let server: Server
let base: string
let control: ServerControl

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'studio-models-'))
  control = { dropAfter: null, ignoreRange: false, corrupt: false, requests: [] }
  server = createServer((req, res) => {
    control.requests.push({ range: req.headers.range })
    if (req.url === '/missing') {
      res.writeHead(404).end()
      return
    }
    const body = control.corrupt ? Buffer.alloc(payload.length, 7) : payload
    const match = /^bytes=(\d+)-$/.exec(req.headers.range ?? '')
    if (match && !control.ignoreRange) {
      const start = Number(match[1])
      if (start >= body.length) {
        res.writeHead(416).end()
        return
      }
      res.writeHead(206, { 'Content-Length': body.length - start }).end(body.subarray(start))
      return
    }
    res.writeHead(200, { 'Content-Length': body.length })
    if (control.dropAfter !== null) {
      const cut = control.dropAfter
      control.dropAfter = null
      res.write(body.subarray(0, cut), () => res.destroy())
      return
    }
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  rmSync(dir, { recursive: true, force: true })
})

function manifest(path = '/model.onnx', version = '1'): ModelManifest {
  return {
    schema: 1,
    packs: [
      {
        id: 'ocr',
        name: 'Text detection',
        description: 'test',
        group: 'essential',
        license: 'Apache-2.0',
        source: 'https://example.com',
        version,
        files: [{ name: 'det.onnx', urls: [`${base}${path}`], sha256: sha(payload), bytes: payload.length }]
      }
    ]
  }
}

async function makeManager(m = manifest()) {
  const updates: ModelStatus[][] = []
  const manager = new ModelManager({
    root: join(dir, 'models'),
    manifest: m,
    fetch: (url, init) => fetch(url, init),
    onChange: (s) => updates.push(s),
    retryDelaysMs: [10, 10]
  })
  await manager.init()
  return { manager, updates }
}

async function settle(manager: ModelManager): Promise<ModelStatus> {
  for (let i = 0; i < 500; i++) {
    const status = manager.statuses()[0] as ModelStatus
    if (status.state === 'installed' || status.state === 'error' || status.state === 'missing') return status
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('download did not settle')
}

describe('ModelManager', () => {
  it('downloads, verifies and installs a pack, and remembers it across restarts', async () => {
    const { manager, updates } = await makeManager()
    expect(manager.statuses()[0]?.state).toBe('missing')
    manager.download(['ocr'])
    expect((await settle(manager)).state).toBe('installed')
    expect(readFileSync(join(dir, 'models/ocr/det.onnx'))).toEqual(payload)
    expect(updates.some((u) => u[0]?.state === 'downloading')).toBe(true)

    const again = await makeManager()
    expect(again.manager.isInstalled('ocr')).toBe(true)
  })

  it('resumes from a partial file with an HTTP Range request after a dropped connection', async () => {
    control.dropAfter = 100_000
    const { manager } = await makeManager()
    manager.download(['ocr'])
    expect((await settle(manager)).state).toBe('installed')
    expect(control.requests.map((r) => r.range)).toEqual([undefined, 'bytes=100000-'])
    expect(readFileSync(join(dir, 'models/ocr/det.onnx'))).toEqual(payload)
  })

  it('restarts cleanly when the server ignores Range', async () => {
    control.dropAfter = 50_000
    control.ignoreRange = true
    const { manager } = await makeManager()
    manager.download(['ocr'])
    expect((await settle(manager)).state).toBe('installed')
    expect(readFileSync(join(dir, 'models/ocr/det.onnx'))).toEqual(payload)
  })

  it('rejects files that fail checksum verification and leaves nothing installed', async () => {
    control.corrupt = true
    const { manager } = await makeManager()
    manager.download(['ocr'])
    const status = await settle(manager)
    expect(status.state).toBe('error')
    expect(status.error).toMatch(/checksum/)
    expect(existsSync(join(dir, 'models/ocr/det.onnx'))).toBe(false)
  })

  it('does not retry client errors such as 404', async () => {
    const { manager } = await makeManager(manifest('/missing'))
    manager.download(['ocr'])
    const status = await settle(manager)
    expect(status.state).toBe('error')
    expect(status.error).toMatch(/404/)
    expect(control.requests).toHaveLength(1)
  })

  it('cancels a queued download', async () => {
    const { manager } = await makeManager()
    manager.download(['ocr'])
    manager.cancel('ocr')
    expect((await settle(manager)).state).toBe('missing')
  })

  it('removes an installed pack', async () => {
    const { manager } = await makeManager()
    manager.download(['ocr'])
    await settle(manager)
    await manager.remove('ocr')
    expect(manager.statuses()[0]?.state).toBe('missing')
    expect(existsSync(join(dir, 'models/ocr'))).toBe(false)
  })

  it('treats a pack as missing when the manifest version changes', async () => {
    const { manager } = await makeManager()
    manager.download(['ocr'])
    await settle(manager)
    const upgraded = await makeManager(manifest('/model.onnx', '2'))
    expect(upgraded.manager.isInstalled('ocr')).toBe(false)
  })

  it('discards an oversized partial file', async () => {
    const { manager } = await makeManager()
    const modelDir = join(dir, 'models/ocr')
    await import('node:fs/promises').then((fs) => fs.mkdir(modelDir, { recursive: true }))
    writeFileSync(join(modelDir, 'det.onnx.part'), Buffer.alloc(payload.length + 10))
    manager.download(['ocr'])
    expect((await settle(manager)).state).toBe('installed')
  })
})
