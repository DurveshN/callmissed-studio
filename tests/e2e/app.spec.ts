import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication

/** Renderer globals as seen from test code (tests compile without DOM lib). */
type RendererGlobals = Record<string, unknown> & {
  studio: { invoke: (channel: string) => Promise<unknown> }
}

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.'] })
})

test.afterAll(async () => {
  await app.close()
})

test('opens the main window with app info from the main process', async () => {
  const window = await app.firstWindow()
  await expect(window).toHaveTitle('CallMissed Studio')
  await expect(window.getByTestId('app-version')).toContainText('Electron')
})

test('renderer is sandboxed from Node', async () => {
  const window = await app.firstWindow()
  const exposed = await window.evaluate(() => {
    const globals = globalThis as unknown as RendererGlobals
    return {
      require: typeof globals['require'],
      process: typeof globals['process'],
      studio: typeof globals.studio.invoke
    }
  })
  expect(exposed).toEqual({ require: 'undefined', process: 'undefined', studio: 'function' })
})

test('bridge rejects unknown channels', async () => {
  const window = await app.firstWindow()
  const result = await window.evaluate(() =>
    (globalThis as unknown as RendererGlobals).studio.invoke('fs:delete-everything')
  )
  expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } })
})

test('loads from the custom protocol, not file://', async () => {
  const window = await app.firstWindow()
  expect(window.url()).toBe('studio://app/index.html')
})
