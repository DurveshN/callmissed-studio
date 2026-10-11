import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { APP_ORIGIN } from './app-protocol'
import { resourcePath } from './paths'
import { rendererOrigin } from './security'

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

  const origin = rendererOrigin()
  void window.loadURL(origin === APP_ORIGIN ? `${APP_ORIGIN}/index.html` : origin)
  return window
}
