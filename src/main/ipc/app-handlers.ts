import { app } from 'electron'
import { handle } from './router'

export function registerAppHandlers(): void {
  handle('app:get-info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform
  }))
}
