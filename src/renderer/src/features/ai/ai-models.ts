import { create } from 'zustand'
import { PREFERRED_AI_MODEL, type AiModel, type AiModelList } from '@shared/ai/models'
import { call } from '../../lib/ipc'
import { notify } from '../../ui/notify'
import { useGenerate } from './generate'

interface ModelsState {
  list: AiModelList | null
  loading: boolean
}

export const useAiModels = create<ModelsState>()(() => ({ list: null, loading: false }))

/** Keeps the chosen model valid for the current list (the preferred one, else the first available). */
function pickModel(models: AiModel[]): void {
  const current = models.find((m) => m.id === useGenerate.getState().model)
  if (current?.available) return
  const choice =
    models.find((m) => m.id === PREFERRED_AI_MODEL && m.available) ?? models.find((m) => m.available)
  if (choice) useGenerate.setState({ model: choice.id })
}

/**
 * The image models for the current key: from main's cache (built from CallMissed's API for this key),
 * or fetched again with `refresh`.
 */
export async function loadAiModels(refresh = false): Promise<void> {
  useAiModels.setState({ loading: true })
  try {
    const list = await call('ai:models', { refresh })
    useAiModels.setState({ list })
    pickModel(list.models)
  } catch (error) {
    notify.error(error, 'Could not load the image models')
  } finally {
    useAiModels.setState({ loading: false })
  }
}

export function modelById(id: string): AiModel | undefined {
  return useAiModels.getState().list?.models.find((m) => m.id === id)
}

/** A model's display name (falls back to its id, e.g. for results made with a model since removed). */
export function useModelName(id: string): string {
  return useAiModels((s) => s.list?.models.find((m) => m.id === id)?.name ?? id)
}
