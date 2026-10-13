import { create } from 'zustand'
import { call } from '../../lib/ipc'

interface KeyState {
  /** Null until read from main. */
  configured: boolean | null
  hint: string | null
  secureStorage: boolean
}

export const useAiKey = create<KeyState>()(() => ({ configured: null, hint: null, secureStorage: true }))

/** Reads whether a CallMissed key is set (the key itself stays in main). */
export async function refreshKeyStatus(): Promise<void> {
  useAiKey.setState(await call('ai:key-status'))
}

export async function saveKey(key: string): Promise<void> {
  useAiKey.setState(await call('ai:set-key', { key }))
}

export async function removeKey(): Promise<void> {
  useAiKey.setState(await call('ai:remove-key'))
}
