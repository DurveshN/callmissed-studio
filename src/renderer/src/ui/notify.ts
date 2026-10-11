import { create } from 'zustand'
import { StudioError } from '@shared/ipc/result'

export interface Toast {
  id: number
  kind: 'info' | 'error'
  message: string
}

interface ToastState {
  toasts: Toast[]
  push(kind: Toast['kind'], message: string): void
  dismiss(id: number): void
}

let nextId = 1
const TOAST_MS = 5000

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    const id = nextId++
    set({ toasts: [...get().toasts, { id, kind, message }] })
    setTimeout(() => get().dismiss(id), TOAST_MS)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

export const notify = {
  info: (message: string) => useToastStore.getState().push('info', message),
  error: (error: unknown, fallback = 'Something went wrong') => {
    console.error(error)
    // Errors carrying a code (IPC and ML errors) have messages written for users; show them.
    const coded = error instanceof Error && typeof (error as { code?: unknown }).code === 'string'
    const message =
      error instanceof StudioError
        ? error.message
        : coded
          ? `${fallback}: ${(error as Error).message}`
          : fallback
    useToastStore.getState().push('error', message)
  }
}

/** Runs an async UI action, reporting failures as a toast. */
export async function attempt(action: () => Promise<unknown>, fallback?: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    notify.error(error, fallback)
  }
}
