import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { registerAppScheme, serveAppProtocol } from './app-protocol'
import { applySecurityPolicies } from './security'
import { registerAppHandlers } from './ipc/app-handlers'
import { createMainWindow } from './window'

app.enableSandbox()
registerAppScheme()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  void app.whenReady().then(() => {
    serveAppProtocol(join(__dirname, '../renderer'))
    applySecurityPolicies()
    registerAppHandlers()
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
