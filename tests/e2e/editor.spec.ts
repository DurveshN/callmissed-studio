import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import {
  closeApp,
  launchApp,
  makePdf,
  makePng,
  openViaMain,
  pngSize,
  stubSaveDialog,
  tempDir
} from './helpers'

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let window: Page
const dir = tempDir('editor')
const photo = join(dir, 'poster.png')
const projectPath = join(dir, 'poster.cmsp')

test.beforeAll(async () => {
  writeFileSync(photo, makePng(400, 300, [30, 120, 200]))
  ;({ app, window } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

async function canvasBox(page: Page) {
  const box = await page.getByTestId('canvas').boundingBox()
  if (!box) throw new Error('canvas not visible')
  return box
}

async function layerRows(page: Page) {
  await page.getByRole('tab', { name: 'Layers' }).click()
  return page.getByTestId('layer-row')
}

test('opens an image into the editor', async () => {
  await openViaMain(app, photo)
  await expect(window.getByTestId('doc-name')).toHaveText('poster')
  await expect(window.getByTestId('canvas').locator('canvas').first()).toBeVisible()
})

test('adds text with the text tool and edits it in place', async () => {
  const box = await canvasBox(window)
  await window.keyboard.press('t')
  await window.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const editor = window.locator('textarea').first()
  await expect(editor).toBeFocused()
  await window.keyboard.type('Hello Studio')
  await window.keyboard.press('Escape')
  await expect(await layerRows(window)).toHaveCount(1)
  await expect((await layerRows(window)).first()).toContainText('Hello Studio')
})

test('draws a rectangle, then undo and redo it', async () => {
  const box = await canvasBox(window)
  await window.keyboard.press('r')
  await window.mouse.move(box.x + 100, box.y + 100)
  await window.mouse.down()
  await window.mouse.move(box.x + 220, box.y + 180, { steps: 5 })
  await window.mouse.up()
  await expect(await layerRows(window)).toHaveCount(2)

  await window.keyboard.press('Control+z')
  await expect(await layerRows(window)).toHaveCount(1)
  await window.keyboard.press('Control+y')
  await expect(await layerRows(window)).toHaveCount(2)
})

test('arranges layers from the layer menu, the canvas menu and the inspector', async () => {
  const rows = await layerRows(window)
  // Panel lists top-most first: the rectangle was drawn after the text.
  await expect(rows.first()).toContainText('Rectangle')

  await rows.filter({ hasText: 'Hello Studio' }).click({ button: 'right' })
  const menu = window.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: /Send to back/ })).toBeDisabled()
  await menu.getByRole('menuitem', { name: /Bring to front/ }).click()
  await expect(menu).toBeHidden()
  await expect(rows.first()).toContainText('Hello Studio')

  // Right-click the rectangle on the canvas (drawn from 100,100 to 220,180).
  const box = await canvasBox(window)
  await window.mouse.click(box.x + 160, box.y + 140, { button: 'right' })
  await window.getByRole('menuitem', { name: /Bring forward/ }).click()
  await expect(rows.first()).toContainText('Rectangle')

  await rows.filter({ hasText: 'Hello Studio' }).click()
  await window.getByRole('tab', { name: 'Inspector' }).click()
  await window.getByRole('button', { name: 'Bring to front' }).click()
  await expect(window.getByRole('button', { name: 'Bring to front' })).toBeDisabled()
  await expect((await layerRows(window)).first()).toContainText('Hello Studio')
})

test('edits a property in the inspector', async () => {
  await (await layerRows(window)).filter({ hasText: 'Hello Studio' }).click()
  await window.getByRole('tab', { name: 'Inspector' }).click()
  const size = window.getByTestId('inspector').getByLabel('Size')
  await size.fill('64')
  await size.press('Enter')
  await expect(size).toHaveValue('64')
})

test('saves a project file', async () => {
  await stubSaveDialog(app, projectPath)
  await window.keyboard.press('Escape')
  await window.keyboard.press('Control+s')
  await expect(window.getByText('Saved')).toBeVisible()
  expect(existsSync(projectPath)).toBe(true)
  expect(readFileSync(projectPath).subarray(0, 2).toString()).toBe('PK')
})

test('exports the page as PNG at its native size', async () => {
  const out = join(dir, 'export.png')
  await stubSaveDialog(app, out)
  await window.keyboard.press('Control+e')
  await window.getByRole('dialog').getByRole('button', { name: 'Export' }).click()
  await expect(window.getByText('Exported')).toBeVisible()
  expect(pngSize(readFileSync(out))).toEqual({ width: 400, height: 300 })
})

test('closes to the start screen and reopens the project from recents', async () => {
  await window.getByRole('button', { name: 'Close document' }).click()
  await expect(window.getByTestId('open-file')).toBeVisible()
  await window
    .getByRole('button', { name: /poster/ })
    .first()
    .click()
  await expect(window.getByTestId('doc-name')).toHaveText('poster')
  const rows = await layerRows(window)
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'Hello Studio' })).toHaveCount(1)
  // Undo history survives the round-trip: the last step was the inspector font-size edit.
  await expect(window.getByRole('button', { name: /^Undo Font size/ })).toBeEnabled()
  await window.keyboard.press('Control+z')
  await expect(window.getByRole('button', { name: /^Redo Font size/ })).toBeEnabled()
})

test('opens a multi-page PDF with a page list', async () => {
  const pdf = join(dir, 'brochure.pdf')
  writeFileSync(pdf, makePdf(['Page one', 'Page two']))
  await openViaMain(app, pdf)
  // The undo above left unsaved changes, so the app asks first.
  await window.getByRole('button', { name: 'Don’t save' }).click()
  await expect(window.getByTestId('doc-name')).toHaveText('brochure')
  await window.getByRole('tab', { name: 'Pages (2)' }).click()
  await expect(window.getByRole('button', { name: 'Page 2' })).toBeVisible()
  await window.getByRole('button', { name: 'Page 2' }).click()
  await expect(window.getByRole('button', { name: 'Page 2' })).toHaveAttribute('data-active', 'true')
})
