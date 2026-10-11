export class CancelledError extends Error {
  constructor() {
    super('Cancelled')
  }
}

interface Entry {
  id: number
  run(signal: AbortSignal): Promise<void>
  abort: AbortController
}

/**
 * Runs ML jobs one at a time (they compete for the same CPU/GPU); queued jobs can be cancelled
 * before they start, and a running job sees its AbortSignal fire.
 */
export class JobQueue {
  private readonly pending: Entry[] = []
  private running: Entry | null = null

  enqueue(id: number, run: (signal: AbortSignal) => Promise<void>): void {
    this.pending.push({ id, run, abort: new AbortController() })
    void this.drain()
  }

  /** Returns true if the job was found (queued or running). */
  cancel(id: number): boolean {
    if (this.running?.id === id) {
      this.running.abort.abort()
      return true
    }
    const index = this.pending.findIndex((e) => e.id === id)
    if (index < 0) return false
    const [entry] = this.pending.splice(index, 1)
    entry?.abort.abort()
    void entry?.run(entry.abort.signal)
    return true
  }

  get size(): number {
    return this.pending.length + (this.running ? 1 : 0)
  }

  private async drain(): Promise<void> {
    if (this.running) return
    for (let next = this.pending.shift(); next; next = this.pending.shift()) {
      this.running = next
      try {
        await next.run(next.abort.signal)
      } finally {
        this.running = null
      }
    }
  }
}

/** Throws CancelledError if the job was cancelled; call between expensive steps. */
export function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledError()
}
