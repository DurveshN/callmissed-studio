import { MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import type { ModelPack } from '@shared/ml/models'
import type { GpuMode, WorkerControl, WorkerNotice } from '@shared/ml/protocol'

export interface MlSupervisorDeps {
  script: string
  modelsDir: string
  packs: ModelPack[]
  gpu(): GpuMode
  /** Model files known to fail on this GPU. */
  cpuOnly(): string[]
  onGpuFailed(message: string): void
  onGpuIncompatible(file: string): void
}

const MAX_RESTARTS = 5
const RESTART_WINDOW_MS = 60_000
const ACK_TIMEOUT_MS = 5000

/**
 * Owns the ML utilityProcess: starts it, restarts it after crashes (with a crash-loop limit),
 * and gives every connected renderer a fresh MessagePort to it.
 */
export class MlSupervisor {
  private child: UtilityProcess | null = null
  private readonly targets = new Set<WebContents>()
  private readonly restarts: number[] = []
  private readonly acks = new Map<number, () => void>()
  private nextRequest = 1
  private stopping = false

  constructor(private readonly deps: MlSupervisorDeps) {}

  start(): void {
    this.stopping = false
    this.spawn()
  }

  stop(): void {
    this.stopping = true
    this.child?.kill()
    this.child = null
  }

  /** Sends the current settings (e.g. after the GPU mode changed); resolves once the worker applied them. */
  configure(): Promise<void> {
    return this.request((requestId) => ({
      type: 'configure',
      modelsDir: this.deps.modelsDir,
      gpu: this.deps.gpu(),
      cpuOnly: this.deps.cpuOnly(),
      packs: this.deps.packs,
      requestId
    }))
  }

  /** Gives `contents` a port to the worker now and again after every worker restart. */
  connect(contents: WebContents): void {
    if (!this.targets.has(contents)) {
      this.targets.add(contents)
      contents.once('destroyed', () => this.targets.delete(contents))
    }
    if (this.child) this.openChannel(contents)
  }

  /** Closes the worker's sessions for these models so their files can be deleted (Windows locks open files). */
  releaseModels(ids: string[]): Promise<void> {
    return this.request((requestId) => ({ type: 'release-models', ids, requestId }))
  }

  /** Sends a control message and resolves when the worker acknowledges it (or after a timeout). */
  private request(build: (requestId: number) => WorkerControl): Promise<void> {
    if (!this.child) return Promise.resolve()
    const requestId = this.nextRequest++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.acks.delete(requestId)
        resolve()
      }, ACK_TIMEOUT_MS)
      this.acks.set(requestId, () => {
        clearTimeout(timer)
        resolve()
      })
      this.send(build(requestId))
    })
  }

  private spawn(): void {
    const child = utilityProcess.fork(this.deps.script, [], {
      serviceName: 'CallMissed Studio ML',
      stdio: 'pipe'
    })
    this.child = child
    child.stdout?.on('data', (d: Buffer) => console.log(`[ml] ${d.toString().trimEnd()}`))
    child.stderr?.on('data', (d: Buffer) => console.error(`[ml] ${d.toString().trimEnd()}`))
    child.on('message', (notice: WorkerNotice) => this.onNotice(notice))
    child.on('exit', (code) => this.onExit(child, code))
    void this.configure()
    for (const contents of this.targets) this.openChannel(contents)
  }

  private onNotice(notice: WorkerNotice): void {
    if (notice.type === 'gpu-failed') this.deps.onGpuFailed(notice.message)
    if (notice.type === 'gpu-incompatible') this.deps.onGpuIncompatible(notice.file)
    if (notice.type === 'ack') {
      this.acks.get(notice.requestId)?.()
      this.acks.delete(notice.requestId)
    }
  }

  private onExit(child: UtilityProcess, code: number): void {
    if (this.child !== child) return
    this.child = null
    for (const ack of this.acks.values()) ack()
    this.acks.clear()
    for (const contents of this.targets) if (!contents.isDestroyed()) contents.send('ml:down')
    if (this.stopping) return

    const now = Date.now()
    this.restarts.push(now)
    while (this.restarts.length && now - (this.restarts[0] ?? now) > RESTART_WINDOW_MS) this.restarts.shift()
    if (this.restarts.length > MAX_RESTARTS) {
      console.error(
        `[ml] worker crashed ${this.restarts.length} times in a minute; not restarting (exit ${code})`
      )
      return
    }
    console.error(`[ml] worker exited with code ${code}; restarting`)
    setTimeout(() => !this.stopping && this.spawn(), 500 * this.restarts.length)
  }

  private openChannel(contents: WebContents): void {
    if (!this.child || contents.isDestroyed()) return
    const { port1, port2 } = new MessageChannelMain()
    this.child.postMessage({ type: 'connect' } satisfies WorkerControl, [port1])
    contents.postMessage('ml:port', null, [port2])
  }

  private send(message: WorkerControl): void {
    this.child?.postMessage(message)
  }
}
