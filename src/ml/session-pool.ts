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
// Fatal only: run-time failures are reported once by run() (with the message), not twice.
const COMMON: InferenceSession.SessionOptions = { graphOptimizationLevel: 'all', logSeverityLevel: 4 }

/**
 * Caches one ONNX Runtime session per model file. Tries DirectML first (when allowed) and falls back
 * to CPU: if creating a DirectML session fails the whole pool stays on CPU (reported once via
 * onGpuFailed); if a model fails while running on DirectML (driver/operator bugs), only that model is
 * reloaded on CPU, the work is retried, and it stays on CPU for the rest of the session.
 */
export class SessionPool {
  private readonly sessions = new Map<string, Promise<LoadedSession>>()
  private modelsDir = ''
  private gpu: GpuMode = 'auto'
  private gpuBroken = false
  /** Model files that failed at run time on DirectML. */
  private readonly cpuOnly = new Set<string>()

  constructor(
    private readonly create: CreateSession,
    private readonly onGpuFailed: (message: string) => void,
    private readonly onCpuOnly: (file: string) => void = () => undefined
  ) {}

  /** Applies new settings; resolves once sessions created under the old settings are released. */
  async configure(modelsDir: string, gpu: GpuMode, cpuOnly: string[] = []): Promise<void> {
    const changed = modelsDir !== this.modelsDir || gpu !== this.gpu
    this.modelsDir = modelsDir
    this.gpu = gpu
    if (gpu === 'auto' && changed) this.gpuBroken = false
    this.cpuOnly.clear()
    for (const file of cpuOnly) this.cpuOnly.add(file)
    if (changed) await this.releaseAll()
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
      pending = this.load(join(this.modelsDir, modelId, file), this.cpuOnly.has(key))
      pending.catch(() => this.sessions.delete(key))
      this.sessions.set(key, pending)
    }
    return pending
  }

  /**
   * Runs `work` with the model's session. If it throws on DirectML, the file is reloaded on CPU and
   * `work` is retried once there.
   */
  async run<T>(
    modelId: string,
    file: string,
    work: (session: InferenceSession) => Promise<T>
  ): Promise<{ result: T; provider: Provider }> {
    const loaded = await this.get(modelId, file)
    try {
      return { result: await work(loaded.session), provider: loaded.provider }
    } catch (error) {
      if (loaded.provider !== 'dml') throw error
      const key = `${modelId}/${file}`
      console.warn(
        `[ml] ${key} failed on DirectML, retrying on CPU:`,
        error instanceof Error ? error.message : error
      )
      this.cpuOnly.add(key)
      this.onCpuOnly(key)
      this.sessions.delete(key)
      void loaded.session.release().catch(() => undefined)
      const cpu = await this.get(modelId, file)
      return { result: await work(cpu.session), provider: cpu.provider }
    }
  }

  private async load(path: string, cpuOnly: boolean): Promise<LoadedSession> {
    if (!existsSync(path)) throw new ModelMissingError(`Model file not found: ${path}`)
    if (this.gpu === 'auto' && !this.gpuBroken && !cpuOnly) {
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
