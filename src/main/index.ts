import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { app, BrowserWindow, net } from 'electron'
import { OPENABLE_EXTENSIONS } from '@shared/file-types'
import type { AppEvent } from '@shared/ipc/channels'
import type { EventPayload } from '@shared/ipc/contracts'
import { ModelManifest } from '@shared/ml/models'
import { registerAppScheme, serveAppProtocol } from './app-protocol'
import { applySecurityPolicies } from './security'
import { registerAppHandlers } from './ipc/app-handlers'
import { registerMlHandlers } from './ipc/ml-handlers'
import { registerProjectHandlers } from './ipc/project-handlers'
import { registerWindowHandlers } from './ipc/window-handlers'
import { LibraryDb } from './services/library-db'
import { MlSupervisor } from './services/ml-supervisor'
import { ModelManager } from './services/model-manager'
import { ProjectService } from './services/project-service'
import { SettingsStore } from './services/settings-store'
import { WorkspaceStore } from './services/workspace-store'
import { dialogs } from './dialogs'
import { resourcePath } from './paths'
import { createMainWindow, markRendererLoading, requestOpen, sendEvent, setDirty } from './window'

// Test-only overrides (isolated profile, local model manifest); never honoured in packaged builds.
const testUserData = app.isPackaged ? undefined : process.env['STUDIO_USER_DATA']
const testManifest = app.isPackaged ? undefined : process.env['STUDIO_MODEL_MANIFEST']
if (testUserData) app.setPath('userData', testUserData)

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

function broadcast<E extends AppEvent>(event: E, payload: EventPayload<E>): void {
  for (const window of BrowserWindow.getAllWindows()) sendEvent(window, event, payload)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let projects: ProjectService | null = null
  let library: LibraryDb | null = null
  let ml: MlSupervisor | null = null

  app.on('second-instance', (_event, argv) => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
    const path = fileFromArgv(argv)
    if (path) requestOpen(window, path)
  })

  void app.whenReady().then(async () => {
    const userData = app.getPath('userData')
    mkdirSync(userData, { recursive: true })

    const settings = new SettingsStore(join(userData, 'settings.json'))
    await settings.load()
    settings.onChange((s) => broadcast('settings:changed', s))

    library = new LibraryDb(join(userData, 'library.db'))
    projects = new ProjectService({
      workspaces: new WorkspaceStore(join(userData, 'workspaces')),
      library,
      appVersion: app.getVersion(),
      pickSavePath: dialogs.pickProjectSavePath
    })

    const manifest = ModelManifest.parse(
      JSON.parse(readFileSync(testManifest ?? resourcePath('models.manifest.json'), 'utf8'))
    )
    const modelsDir = join(userData, 'models')
    const models = new ModelManager({
      root: modelsDir,
      manifest,
      fetch: (url, init) => net.fetch(url, init),
      onChange: (statuses) => broadcast('models:changed', statuses)
    })
    await models.init()

    const supervisor = new MlSupervisor({
      script: join(__dirname, 'ml-worker.js'),
      modelsDir,
      packs: manifest.packs,
      gpu: () => settings.get().gpu,
      onGpuFailed: (message) => broadcast('ml:gpu-failed', { message })
    })
    ml = supervisor
    supervisor.start()

    serveAppProtocol(join(__dirname, '../renderer'))
    applySecurityPolicies()
    registerAppHandlers()
    registerProjectHandlers(projects, library)
    registerWindowHandlers()
    registerMlHandlers(models, supervisor, settings)

    const window = createMainWindow()
    const services = projects
    // A (re)loading renderer has no document yet; work from a previous load becomes recoverable.
    window.webContents.on('did-start-loading', () => {
      services.releaseAll()
      setDirty(window, false)
      markRendererLoading(window)
    })
    // Each load gets a fresh port to the ML worker (the preload of the previous page is gone).
    window.webContents.on('did-finish-load', () => supervisor.connect(window.webContents))
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('Renderer process gone', details.reason)
      if (details.reason !== 'clean-exit') window.reload()
    })
    const initial = fileFromArgv(process.argv)
    if (initial) requestOpen(window, initial)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Clean exit: open workspaces are either saved or explicitly discarded, so they can go.
  app.on('will-quit', () => {
    ml?.stop()
    projects?.closeAllSync()
    library?.close()
  })
}
