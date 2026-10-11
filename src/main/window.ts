import { join } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { AppEvent } from '@shared/ipc/channels'
import type { EventPayload } from '@shared/ipc/contracts'
import { APP_ORIGIN } from './app-protocol'
import { resourcePath } from './paths'
import { rendererOrigin } from './security'

/** Per-window state the close guard needs. */
const dirtyWindows = new WeakSet<BrowserWindow>()
const confirmedClose = new WeakSet<BrowserWindow>()

export function setDirty(window: BrowserWindow, dirty: boolean): void {
  if (dirty) dirtyWindows.add(window)
  else dirtyWindows.delete(window)
}

/** The renderer finished saving (or the user chose not to); let the window close. */
export function confirmClose(window: BrowserWindow): void {
  confirmedClose.add(window)
  window.close()
}

export function sendEvent<E extends AppEvent>(
  window: BrowserWindow,
  event: E,
  payload: EventPayload<E>
): void {
  window.webContents.send(event, payload)
}

function guardUnsavedChanges(window: BrowserWindow): void {
  window.on('close', (event) => {
    if (confirmedClose.has(window) || !dirtyWindows.has(window)) return
    event.preventDefault()
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      title: 'Unsaved changes',
      message: 'Save changes before closing?',
      detail: 'Your changes will be lost if you don’t save them.',
      buttons: ['Save', 'Don’t save', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (choice === 0) sendEvent(window, 'app:save-and-close', undefined)
    if (choice === 1) confirmClose(window)
  })
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'CallMissed Studio',
    icon: resourcePath('icon.png'),
    backgroundColor: '#f7f7f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => window.show())
  guardUnsavedChanges(window)

  const origin = rendererOrigin()
  void window.loadURL(origin === APP_ORIGIN ? `${APP_ORIGIN}/index.html` : origin)
  return window
}
