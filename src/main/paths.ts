import { join } from 'node:path'
import { app } from 'electron'

/** Absolute path to a file in `resources/` (copied next to the app by electron-builder when packaged). */
export function resourcePath(...segments: string[]): string {
  const base = app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
  return join(base, ...segments)
}
