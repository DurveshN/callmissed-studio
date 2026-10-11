import { createHash } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { identityOnnx } from '../fixtures/onnx'
import { closeApp, launchApp, tempDir } from './helpers'

test.describe.configure({ mode: 'serial' })

const model = identityOnnx()
const dir = tempDir('models-e2e')
const userData = tempDir('models-profile')
let server: Server
let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  server = createServer((_req, res) => res.writeHead(200, { 'Content-Length': model.length }).end(model))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/identity.onnx`
  const file = {
    name: 'det.onnx',
    urls: [url],
    sha256: createHash('sha256').update(model).digest('hex'),
    bytes: model.length
  }
  const pack = (id: string, name: string, group: string) => ({
    id,
    name,
    description: `${name} test model`,
    group,
    license: 'Apache-2.0',
    source: 'https://example.com',
    version: '1',
    files: [file]
  })
  const manifest = join(dir, 'manifest.json')
  writeFileSync(
    manifest,
    JSON.stringify({
      schema: 1,
      packs: [pack('ocr', 'Text detection', 'essential'), pack('inpaint', 'High-quality eraser', 'optional')]
    })
  )
  ;({ app, window } = await launchApp({
    userData,
    modelSetupDone: false,
    env: { STUDIO_MODEL_MANIFEST: manifest }
  }))
})

test.afterAll(async () => {
  await closeApp(app)
  await new Promise((resolve) => server.close(resolve))
})

const row = (id: string) => window.getByTestId(`model-${id}`)

test('first launch shows the AI setup screen with every pack selected', async () => {
  await expect(window.getByTestId('model-setup')).toBeVisible()
  await expect(row('ocr').getByRole('checkbox')).toBeChecked()
  await expect(row('inpaint').getByRole('checkbox')).toBeChecked()
})

test('downloads, verifies and installs the selected packs', async () => {
  await row('inpaint').getByRole('checkbox').uncheck()
  await window.getByRole('button', { name: /^Download/ }).click()
  await expect(row('ocr').getByTestId('model-state')).toHaveText('Installed')
  await expect(row('inpaint').getByTestId('model-state')).toHaveText('Not installed')
  expect(existsSync(join(userData, 'models', 'ocr', 'det.onnx'))).toBe(true)
  await window.getByRole('button', { name: 'Skip for now' }).click()
  await expect(window.getByTestId('open-file')).toBeVisible()
})

test('loads an installed model in the ML worker from Settings', async () => {
  await window.getByRole('button', { name: 'Settings' }).click()
  const dialog = window.getByRole('dialog')
  await dialog.getByTestId('model-ocr').getByRole('button', { name: 'Test' }).click()
  await expect(window.getByText(/Text detection works — loaded on (GPU \(DirectML\)|CPU)/)).toBeVisible()
})

test('runs on the CPU when GPU acceleration is turned off', async () => {
  const dialog = window.getByRole('dialog')
  await dialog.getByLabel(/Use GPU acceleration/).uncheck()
  await dialog.getByTestId('model-ocr').getByRole('button', { name: 'Test' }).click()
  await expect(window.getByText('Text detection works — loaded on CPU', { exact: false })).toBeVisible()
})

test('downloads an optional pack from Settings and removes it again', async () => {
  const dialog = window.getByRole('dialog')
  await dialog.getByTestId('model-inpaint').getByRole('button', { name: 'Download' }).click()
  await expect(dialog.getByTestId('model-inpaint').getByTestId('model-state')).toHaveText('Installed')
  await dialog.getByRole('button', { name: 'Remove High-quality eraser' }).click()
  await expect(dialog.getByTestId('model-inpaint').getByTestId('model-state')).toHaveText('Not installed')
  expect(existsSync(join(userData, 'models', 'inpaint'))).toBe(false)
})

test('reports a missing model instead of crashing', async () => {
  const result = await window.evaluate(async () => {
    const studio = (
      globalThis as unknown as {
        studio: { ml: { run(kind: string, input: unknown): { result: Promise<unknown> } } }
      }
    ).studio
    return studio.ml.run('probe', { model: 'inpaint' }).result
  })
  expect(result).toMatchObject({ ok: false, code: 'MODEL_MISSING' })
})
