import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readPng } from '../fixtures/png'
import {
  closeApp,
  launchApp,
  openViaMain,
  seedModels,
  stubOpenDialog,
  stubSaveDialog,
  tempDir
} from './helpers'

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const poster = resolve('tests/fixtures/ocr-poster.png')
const EXPECTED = [
  'CallMissed Studio',
  'SUMMER SALE 50% OFF',
  'Visit us at 42 Market Street',
  'Fresh Coffee',
  'Open every day'
]
const dir = tempDir('text-e2e')
let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  test.setTimeout(240_000)
  const userData = tempDir('text-profile')
  await seedModels(userData, ['ocr'])
  ;({ app, window } = await launchApp({ userData }))
})

test.afterAll(async () => {
  await closeApp(app)
})

async function layerRows() {
  await window.getByRole('tab', { name: 'Layers' }).click()
  return window.getByTestId('layer-row')
}

const bar = () => window.getByTestId('detect-bar')

test('detects every line of text on the page', async () => {
  await openViaMain(app, poster)
  await expect(window.getByTestId('doc-name')).toHaveText('ocr-poster')
  await window.keyboard.press('d')
  await expect(bar()).toHaveAttribute('data-status', 'ready', { timeout: 60_000 })
  await expect(bar()).toContainText('5 text lines found on this page')
})

test('converts all lines into editable text layers with matched fonts', async () => {
  await bar().getByRole('button', { name: 'Convert all' }).click()
  await expect(bar()).toBeHidden({ timeout: 60_000 })
  const rows = await layerRows()
  await expect(rows).toHaveCount(5)
  for (const text of EXPECTED) await expect(rows.filter({ hasText: text })).toHaveCount(1)

  await rows.filter({ hasText: 'CallMissed Studio' }).click()
  await window.getByRole('tab', { name: 'Inspector' }).click()
  const inspector = window.getByTestId('inspector')
  await expect(inspector.getByLabel('Font')).toHaveValue('Arial')
  await expect(inspector.getByLabel('Weight')).toHaveValue('400')

  await (await layerRows()).filter({ hasText: 'SUMMER SALE' }).click()
  await window.getByRole('tab', { name: 'Inspector' }).click()
  await expect(inspector.getByLabel('Font')).toHaveValue('Arial')
  await expect(inspector.getByLabel('Weight')).toHaveValue('700')

  await (await layerRows()).filter({ hasText: 'Fresh Coffee' }).click()
  await window.getByRole('tab', { name: 'Inspector' }).click()
  const rotation = Number(await inspector.getByLabel('Rotation').inputValue())
  expect(rotation).toBe(-12)
})

test('erases the original text from the background', async () => {
  // Hide the new text layers, export, and check the old text area is plain background.
  const rows = await layerRows()
  await rows.first().click()
  await window.keyboard.press('Control+a')
  await rows.first().click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Hide' }).click()
  const out = join(dir, 'erased.png')
  await stubSaveDialog(app, out)
  await window.keyboard.press('Control+e')
  await window.getByRole('dialog').getByRole('button', { name: 'Export' }).click()
  await expect(window.getByText('Exported')).toBeVisible()

  const png = readPng(out)
  let worst = 0
  for (let y = 62; y < 108; y += 2) {
    for (let x = 70; x < 500; x += 3) {
      const i = (y * png.width + x) * 4
      worst = Math.max(
        worst,
        Math.hypot(
          (png.data[i] as number) - 245,
          (png.data[i + 1] as number) - 243,
          (png.data[i + 2] as number) - 238
        )
      )
    }
  }
  expect(worst).toBeLessThan(40)
})

test('undoes the whole conversion in one step', async () => {
  await window.keyboard.press('Control+z') // hide
  await window.keyboard.press('Control+z') // conversion
  await expect(await layerRows()).toHaveCount(0)
})

test('detects and converts text inside an inserted image layer (e.g. an AI result)', async () => {
  await stubOpenDialog(app, poster)
  await window.keyboard.press('i')
  const rows = await layerRows()
  await expect(rows).toHaveCount(1)
  await rows.first().click()
  await window.keyboard.press('d')
  await expect(bar()).toHaveAttribute('data-status', 'ready', { timeout: 60_000 })
  await expect(bar()).toContainText('5 text lines found in the selected image')
  await bar().getByRole('button', { name: 'Convert all' }).click()
  await expect(bar()).toBeHidden({ timeout: 60_000 })
  const after = await layerRows()
  await expect(after).toHaveCount(6)
  // Text sits directly above its image, keeping the image below.
  await expect(after.last()).toContainText('ocr-poster')
  for (const text of EXPECTED) await expect(after.filter({ hasText: text })).toHaveCount(1)
})

test('fixture is intact', () => {
  // Guards against accidentally editing the committed fixture.
  expect(readFileSync(poster).length).toBeGreaterThan(10_000)
})

test('matches fonts consistently across a dense diagram', async () => {
  await window.getByRole('button', { name: 'Close document' }).click()
  await window.getByRole('button', { name: 'Don’t save' }).click()
  await openViaMain(app, resolve('tests/fixtures/diagram.png'))
  await expect(window.getByTestId('doc-name')).toHaveText('diagram')
  await window.keyboard.press('d')
  await expect(bar()).toHaveAttribute('data-status', 'ready', { timeout: 60_000 })
  await expect(bar()).toContainText('32 text lines found')
  await bar().getByRole('button', { name: 'Convert all' }).click()
  await expect(bar()).toBeHidden({ timeout: 120_000 })

  const out = join(dir, 'diagram.cmsp')
  await stubSaveDialog(app, out)
  await window.keyboard.press('Control+s')
  await expect(window.getByText('Saved')).toBeVisible()
  const doc = JSON.parse(strFromU8(unzipSync(readFileSync(out))['document.json'] as Uint8Array)) as {
    pages: { layers: { text: string; fontFamily: string; fontWeight: number; fontSize: number }[] }[]
  }
  const layers = doc.pages[0]?.layers ?? []
  expect(layers).toHaveLength(32)
  expect(layers.map((l) => l.text)).toContain('• rejection flags')
  // The fixture uses Calibri Bold 26 for titles and Calibri 22 for bullet items.
  for (const layer of layers.filter((l) => !l.text.startsWith('•') && l.text !== 'structured tuples')) {
    expect([layer.text, layer.fontFamily, layer.fontWeight, Math.round(layer.fontSize)]).toEqual([
      layer.text,
      'Calibri',
      700,
      26
    ])
  }
  for (const layer of layers.filter((l) => l.text.startsWith('•'))) {
    expect([layer.text, layer.fontFamily, layer.fontWeight, Math.round(layer.fontSize)]).toEqual([
      layer.text,
      'Calibri',
      400,
      22
    ])
  }
})
