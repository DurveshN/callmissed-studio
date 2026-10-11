import { createHash, type Hash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  packBytes,
  type ModelFile,
  type ModelId,
  type ModelManifest,
  type ModelPack,
  type ModelStatus
} from '@shared/ml/models'
import { writeFileAtomic } from './fs-utils'

type Fetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<Response>

export interface ModelManagerDeps {
  /** userData/models */
  root: string
  manifest: ModelManifest
  fetch: Fetch
  onChange(statuses: ModelStatus[]): void
  /** Waits between attempts for one URL (also the number of retries). */
  retryDelaysMs?: number[]
}

const INSTALLED_FILE = 'installed.json'
const Installed = z.record(z.string(), z.object({ version: z.string() }))
const PROGRESS_INTERVAL_MS = 150

class DownloadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
  }
}

interface Runtime {
  state: ModelStatus['state']
  receivedBytes: number
  error: string | null
}

/** Downloads, verifies (SHA-256), installs and removes model packs listed in the manifest. */
export class ModelManager {
  private installed: z.infer<typeof Installed> = {}
  private readonly runtime = new Map<ModelId, Runtime>()
  private readonly queue: ModelId[] = []
  private active: { id: ModelId; abort: AbortController } | null = null
  private pumping = false
  private lastEmit = 0

  constructor(private readonly deps: ModelManagerDeps) {}

  async init(): Promise<void> {
    await mkdir(this.deps.root, { recursive: true })
    try {
      this.installed = Installed.parse(
        JSON.parse(await readFile(join(this.deps.root, INSTALLED_FILE), 'utf8'))
      )
    } catch {
      this.installed = {}
    }
    for (const pack of this.deps.manifest.packs) {
      const ok = await this.filesPresent(pack)
      this.runtime.set(pack.id, {
        state: ok ? 'installed' : 'missing',
        receivedBytes: ok ? packBytes(pack) : 0,
        error: null
      })
    }
  }

  pack(id: ModelId): ModelPack {
    const pack = this.deps.manifest.packs.find((p) => p.id === id)
    if (!pack) throw new Error(`Unknown model ${id}`)
    return pack
  }

  dir(id: ModelId): string {
    return join(this.deps.root, id)
  }

  isInstalled(id: ModelId): boolean {
    return this.runtime.get(id)?.state === 'installed'
  }

  statuses(): ModelStatus[] {
    return this.deps.manifest.packs.map((pack) => {
      const rt = this.runtime.get(pack.id) ?? { state: 'missing', receivedBytes: 0, error: null }
      return {
        id: pack.id,
        name: pack.name,
        description: pack.description,
        group: pack.group,
        license: pack.license,
        totalBytes: packBytes(pack),
        ...rt
      }
    })
  }

  download(ids: ModelId[]): void {
    for (const id of ids) {
      const state = this.runtime.get(id)?.state
      if (state === 'installed' || state === 'queued' || state === 'downloading' || state === 'verifying')
        continue
      this.set(id, { state: 'queued', error: null })
      this.queue.push(id)
    }
    this.emit(true)
    void this.pump()
  }

  /** Stops a queued or running download; partial files are kept so the next attempt resumes. */
  cancel(id: ModelId): void {
    const queued = this.queue.indexOf(id)
    if (queued >= 0) {
      this.queue.splice(queued, 1)
      this.set(id, { state: 'missing' })
      this.emit(true)
    }
    if (this.active?.id === id) this.active.abort.abort()
  }

  async remove(id: ModelId): Promise<void> {
    this.cancel(id)
    while (this.active?.id === id) await new Promise((r) => setTimeout(r, 20))
    await rm(this.dir(id), { recursive: true, force: true })
    this.installed = Object.fromEntries(Object.entries(this.installed).filter(([key]) => key !== id))
    await this.saveInstalled()
    this.set(id, { state: 'missing', receivedBytes: 0, error: null })
    this.emit(true)
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      for (let id = this.queue.shift(); id; id = this.queue.shift()) {
        const abort = new AbortController()
        this.active = { id, abort }
        try {
          await this.installPack(this.pack(id), abort.signal)
          this.set(id, { state: 'installed', error: null })
        } catch (error) {
          const cancelled = abort.signal.aborted
          this.set(id, {
            state: cancelled ? 'missing' : 'error',
            error: cancelled ? null : error instanceof Error ? error.message : String(error)
          })
        } finally {
          this.active = null
          this.emit(true)
        }
      }
    } finally {
      this.pumping = false
    }
  }

  private async installPack(pack: ModelPack, signal: AbortSignal): Promise<void> {
    const dir = this.dir(pack.id)
    if (this.installed[pack.id] && this.installed[pack.id]?.version !== pack.version) {
      await rm(dir, { recursive: true, force: true })
    }
    await mkdir(dir, { recursive: true })
    let done = 0
    this.set(pack.id, { state: 'downloading', receivedBytes: 0 })
    this.emit(true)
    for (const file of pack.files) {
      const target = join(dir, file.name)
      // Final names are only ever produced by a verified rename, so a correctly sized file is trusted.
      if (!(existsSync(target) && (await stat(target)).size === file.bytes)) {
        await this.fetchFile(pack.id, file, target, signal, (bytes) => {
          this.set(pack.id, { receivedBytes: done + bytes })
          this.emit(false)
        })
      }
      done += file.bytes
      this.set(pack.id, { receivedBytes: done })
    }
    this.installed[pack.id] = { version: pack.version }
    await this.saveInstalled()
  }

  private async fetchFile(
    id: ModelId,
    file: ModelFile,
    target: string,
    signal: AbortSignal,
    progress: (bytes: number) => void
  ) {
    const delays = this.deps.retryDelaysMs ?? [1000, 4000, 9000]
    let lastError: Error = new Error('No download URL')
    for (const url of file.urls) {
      for (let attempt = 0; attempt <= delays.length; attempt++) {
        if (signal.aborted) throw new Error('Cancelled')
        try {
          await this.attempt(id, url, file, target, signal, progress)
          return
        } catch (error) {
          if (signal.aborted) throw error
          lastError = error instanceof Error ? error : new Error(String(error))
          if (error instanceof DownloadError && !error.retryable) break
          const delay = delays[attempt]
          if (delay !== undefined) await sleep(delay, signal)
        }
      }
    }
    throw new Error(`Download failed: ${lastError.message}. Check your internet connection and try again.`)
  }

  /** One download attempt, resuming from `<target>.part` when the server supports ranges. */
  private async attempt(
    id: ModelId,
    url: string,
    file: ModelFile,
    target: string,
    signal: AbortSignal,
    progress: (n: number) => void
  ) {
    const part = `${target}.part`
    let hash = createHash('sha256')
    let offset = 0
    if (existsSync(part)) {
      offset = (await stat(part)).size
      if (offset > file.bytes) {
        await rm(part)
        offset = 0
      } else {
        await hashFile(part, hash)
      }
    }

    if (offset < file.bytes) {
      const response = await this.deps.fetch(url, {
        headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
        signal
      })
      if (response.status === 416) {
        await rm(part, { force: true })
        throw new DownloadError('Server rejected the resume request', true)
      }
      if (!response.ok || !response.body) {
        throw new DownloadError(
          `Server responded ${response.status}`,
          response.status >= 500 || response.status === 429
        )
      }
      if (offset > 0 && response.status === 200) {
        // Server ignored the Range header: start over.
        offset = 0
        hash = createHash('sha256')
        await rm(part, { force: true })
      }

      const handle = await open(part, 'a')
      try {
        progress(offset)
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          await handle.write(chunk)
          hash.update(chunk)
          offset += chunk.length
          if (offset > file.bytes) throw new DownloadError('Received more data than expected', true)
          progress(offset)
        }
      } finally {
        await handle.close()
      }
    }

    if (offset !== file.bytes) throw new DownloadError('Connection ended early', true)
    this.set(id, { state: 'verifying' })
    this.emit(true)
    if (hash.digest('hex') !== file.sha256) {
      await rm(part, { force: true })
      throw new DownloadError(`${file.name} failed checksum verification`, true)
    }
    await rename(part, target)
    this.set(id, { state: 'downloading' })
  }

  private async filesPresent(pack: ModelPack): Promise<boolean> {
    if (this.installed[pack.id]?.version !== pack.version) return false
    for (const file of pack.files) {
      const path = join(this.dir(pack.id), file.name)
      if (!existsSync(path) || (await stat(path)).size !== file.bytes) return false
    }
    return true
  }

  private async saveInstalled(): Promise<void> {
    await writeFileAtomic(join(this.deps.root, INSTALLED_FILE), JSON.stringify(this.installed))
  }

  private set(id: ModelId, patch: Partial<Runtime>): void {
    const current = this.runtime.get(id) ?? { state: 'missing', receivedBytes: 0, error: null }
    this.runtime.set(id, { ...current, ...patch })
  }

  private emit(force: boolean): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < PROGRESS_INTERVAL_MS) return
    this.lastEmit = now
    this.deps.onChange(this.statuses())
  }
}

function hashFile(path: string, hash: Hash): Promise<void> {
  return new Promise((resolve, reject) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', resolve)
      .on('error', reject)
  })
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
