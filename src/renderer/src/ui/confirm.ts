import { create } from 'zustand'

export interface ConfirmRequest<T extends string> {
  title: string
  message: string
  /** Buttons left to right; the first is the default (primary) action. */
  choices: readonly { id: T; label: string }[]
  cancel: T
}

interface ConfirmState {
  request: (ConfirmRequest<string> & { resolve(choice: string): void }) | null
  answer(choice: string): void
}

export const useConfirmStore = create<ConfirmState>()((set, get) => ({
  request: null,
  answer: (choice) => {
    get().request?.resolve(choice)
    set({ request: null })
  }
}))

/** Shows an in-app modal and resolves with the chosen id. */
export function confirm<T extends string>(request: ConfirmRequest<T>): Promise<T> {
  return new Promise((resolve) => {
    useConfirmStore.getState().request?.resolve(useConfirmStore.getState().request?.cancel ?? '')
    useConfirmStore.setState({ request: { ...request, resolve: (c) => resolve(c as T) } })
  })
}
