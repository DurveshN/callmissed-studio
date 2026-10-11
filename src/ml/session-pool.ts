import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { InferenceSession } from 'onnxruntime-node'
import type { GpuMode } from '@shared/ml/protocol'

export type Provider = 'dml' | 'cpu'

export interface LoadedSession {
  session: InferenceSession
  provider: Provider
}

type CreateSession = (path: string, options: InferenceSession.SessionOptions) => Promise<InferenceSession>

export class ModelMissingError extends Error {}
export class ModelLoadError extends Error {}

/** DirectML needs sequential execution and no memory pattern (ONNX Runtime DML EP requirements). */
const DML_OPTIONS: InferenceSession.SessionOptions = {
  executionProviders: ['dml', 'cpu'],
  enableMemPattern: false,
  executionMode: 'sequential'
}
const CPU_OPTIONS: InferenceSession.SessionOptions = { executionProviders: ['cpu'] }
const COMMON: InferenceSession.SessionOptions = { graphOptimizationLevel: 'all', logSeverityLevel: 3 }

/**
 * Caches one ONNX Runtime session per model file. Tries DirectML first (when allowed) and falls back
 * to CPU; after a DirectML failure the whole pool stays on CPU and reports it once via onGpuFailed.
 */
export class SessionPool {
  private readonly sessions = new Map<string, Promise<LoadedSession>>()
  private modelsDir = ''
  private gpu: GpuMode = 'auto'
  private gpuBroken = false

  constructor(
    private readonly create: CreateSession,
    private readonly onGpuFailed: (message: string) => void
  ) {}

  configure(modelsDir: string, gpu: GpuMode): void {
    const changed = modelsDir !== this.modelsDir || gpu !== this.gpu
    this.modelsDir = modelsDir
    this.gpu = gpu
    if (gpu === 'auto') this.gpuBroken = false
    if (changed) void this.releaseAll()
  }

  /** Absolute path of a model file (for non-ONNX assets such as dictionaries). */
  filePath(modelId: string, file: string): string {
    const path = join(this.modelsDir, modelId, file)
    if (!existsSync(path)) throw new ModelMissingError(`Model file not found: ${path}`)
    return path
  }

  get(modelId: string, file: string): Promise<LoadedSession> {
    const key = `${modelId}/${file}`
    let pending = this.sessions.get(key)
    if (!pending) {
      pending = this.load(join(this.modelsDir, modelId, file))
      pending.catch(() => this.sessions.delete(key))
      this.sessions.set(key, pending)
    }
    return pending
  }

  private async load(path: string): Promise<LoadedSession> {
    if (!existsSync(path)) throw new ModelMissingError(`Model file not found: ${path}`)
    if (this.gpu === 'auto' && !this.gpuBroken) {
      try {
        return { session: await this.create(path, { ...COMMON, ...DML_OPTIONS }), provider: 'dml' }
      } catch (error) {
        this.gpuBroken = true
        this.onGpuFailed(error instanceof Error ? error.message : String(error))
      }
    }
    try {
      return { session: await this.create(path, { ...COMMON, ...CPU_OPTIONS }), provider: 'cpu' }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new ModelLoadError(
        `Could not load ${basename(path)}: ${reason}. Try re-downloading it in Settings.`
      )
    }
  }

  async release(modelIds: string[]): Promise<void> {
    const prefixes = modelIds.map((id) => `${id}/`)
    await Promise.all(
      [...this.sessions.entries()]
        .filter(([key]) => prefixes.some((p) => key.startsWith(p)))
        .map(async ([key, pending]) => {
          this.sessions.delete(key)
          await pending.then((s) => s.session.release()).catch(() => undefined)
        })
    )
  }

  async releaseAll(): Promise<void> {
    const all = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(all.map((p) => p.then((s) => s.session.release()).catch(() => undefined)))
  }
}
