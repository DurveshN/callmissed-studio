import { create } from 'zustand'
import type { ModelId, ModelStatus } from '@shared/ml/models'
import type { Settings } from '@shared/settings'
import { call } from '../../lib/ipc'
import { attempt, notify } from '../../ui/notify'

interface ModelsState {
  statuses: ModelStatus[]
  settings: Settings | null
  loaded: boolean
}

export const useModelsStore = create<ModelsState>()(() => ({ statuses: [], settings: null, loaded: false }))

/** Loads model statuses + settings and keeps them in sync with main; returns an unsubscribe function. */
export function startModelSync(): () => void {
  void Promise.all([call('models:list'), call('settings:get')])
    .then(([statuses, settings]) => useModelsStore.setState({ statuses, settings, loaded: true }))
    .catch((error: unknown) => notify.error(error, 'Could not read AI model status'))
  const offModels = window.studio.on('models:changed', (statuses) => useModelsStore.setState({ statuses }))
  const offSettings = window.studio.on('settings:changed', (settings) =>
    useModelsStore.setState({ settings })
  )
  const offGpu = window.studio.on('ml:gpu-failed', () =>
    notify.info('GPU acceleration is unavailable on this device, so AI features will run on the CPU.')
  )
  return () => {
    offModels()
    offSettings()
    offGpu()
  }
}

export const modelActions = {
  download: (ids: ModelId[]) =>
    attempt(() => call('models:download', { ids }), 'Could not start the download'),
  cancel: (id: ModelId) => attempt(() => call('models:cancel', { id })),
  remove: (id: ModelId) => attempt(() => call('models:remove', { id }), 'Could not remove the model'),
  /** Applies the change immediately (so controls respond instantly) and reverts if saving fails. */
  updateSettings: async (patch: Partial<Settings>) => {
    const previous = useModelsStore.getState().settings
    if (previous) useModelsStore.setState({ settings: { ...previous, ...patch } })
    try {
      useModelsStore.setState({ settings: await call('settings:update', patch) })
    } catch (error) {
      useModelsStore.setState({ settings: previous })
      notify.error(error, 'Could not save settings')
    }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export const isBusy = (s: ModelStatus) =>
  s.state === 'queued' || s.state === 'downloading' || s.state === 'verifying'
