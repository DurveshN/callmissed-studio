import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let window: Page

/** Renderer globals as seen from test code (tests compile without DOM lib). */
type RendererGlobals = Record<string, unknown> & {
  studio: { invoke: (channel: string) => Promise<unknown> }
}

test.beforeAll(async () => {
  ;({ app, window } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

test('opens on the start screen', async () => {
  await expect(window).toHaveTitle('CallMissed Studio')
  await expect(window.getByTestId('open-file')).toBeVisible()
})

test('renderer is sandboxed from Node', async () => {
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
  const result = await window.evaluate(() =>
    (globalThis as unknown as RendererGlobals).studio.invoke('fs:delete-everything')
  )
  expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } })
})

test('main validates IPC input', async () => {
  const result = await window.evaluate(() =>
    (
      globalThis as unknown as { studio: { invoke: (c: string, i: unknown) => Promise<unknown> } }
    ).studio.invoke('asset:read', { docId: '../../etc', assetId: 'x' })
  )
  expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
})

test('loads from the custom protocol, not file://', async () => {
  expect(window.url()).toBe('studio://app/index.html')
})
