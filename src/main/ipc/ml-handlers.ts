import type { MlSupervisor } from '../services/ml-supervisor'
import type { ModelManager } from '../services/model-manager'
import type { SettingsStore } from '../services/settings-store'
import { handle } from './router'

export function registerMlHandlers(models: ModelManager, ml: MlSupervisor, settings: SettingsStore): void {
  handle('models:list', () => models.statuses())
  handle('models:download', ({ ids }) => {
    models.download(ids)
  })
  handle('models:cancel', ({ id }) => {
    models.cancel(id)
  })
  handle('models:remove', async ({ id }) => {
    // Loaded models keep their files locked on Windows; unload them first.
    await ml.releaseModels([id])
    await models.remove(id)
  })

  handle('settings:get', () => settings.get())
  handle('settings:update', (patch) => settings.update(patch))
}
