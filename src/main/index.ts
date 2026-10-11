import { existsSync, mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { OPENABLE_EXTENSIONS } from '@shared/file-types'
import { registerAppScheme, serveAppProtocol } from './app-protocol'
import { applySecurityPolicies } from './security'
import { registerAppHandlers } from './ipc/app-handlers'
import { registerProjectHandlers } from './ipc/project-handlers'
import { registerWindowHandlers } from './ipc/window-handlers'
import { LibraryDb } from './services/library-db'
import { ProjectService } from './services/project-service'
import { WorkspaceStore } from './services/workspace-store'
import { dialogs } from './dialogs'
import { createMainWindow, sendEvent, setDirty } from './window'

// Lets tests run against an isolated profile; never honoured in packaged builds.
const testUserData = process.env['STUDIO_USER_DATA']
if (testUserData && !app.isPackaged) app.setPath('userData', testUserData)

app.enableSandbox()
registerAppScheme()

/** First argument that is an openable file (Open With / file association / drag onto exe). */
function fileFromArgv(argv: string[]): string | null {
  const openable = new Set<string>(OPENABLE_EXTENSIONS)
  return (
    argv
      .slice(1)
      .find(
        (arg) => !arg.startsWith('-') && openable.has(extname(arg).slice(1).toLowerCase()) && existsSync(arg)
      ) ?? null
  )
}

function openInWindow(window: BrowserWindow, path: string): void {
  const send = () => sendEvent(window, 'app:open-path', { path })
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', send)
  else send()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let projects: ProjectService | null = null
  let library: LibraryDb | null = null

  app.on('second-instance', (_event, argv) => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
    const path = fileFromArgv(argv)
    if (path) openInWindow(window, path)
  })

  void app.whenReady().then(() => {
    const userData = app.getPath('userData')
    mkdirSync(userData, { recursive: true })
    library = new LibraryDb(join(userData, 'library.db'))
    projects = new ProjectService({
      workspaces: new WorkspaceStore(join(userData, 'workspaces')),
      library,
      appVersion: app.getVersion(),
      pickSavePath: dialogs.pickProjectSavePath
    })

    serveAppProtocol(join(__dirname, '../renderer'))
    applySecurityPolicies()
    registerAppHandlers()
    registerProjectHandlers(projects, library)
    registerWindowHandlers()

    const window = createMainWindow()
    const services = projects
    // A (re)loading renderer has no document yet; work from a previous load becomes recoverable.
    window.webContents.on('did-start-loading', () => {
      services.releaseAll()
      setDirty(window, false)
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('Renderer process gone', details.reason)
      if (details.reason !== 'clean-exit') window.reload()
    })
    const initial = fileFromArgv(process.argv)
    if (initial) openInWindow(window, initial)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Clean exit: open workspaces are either saved or explicitly discarded, so they can go.
  app.on('will-quit', () => {
    projects?.closeAllSync()
    library?.close()
  })
}
