import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fontkit from '@cantoo/fontkit'
import { PDFDocument, TextRenderingMode } from '@cantoo/pdf-lib'
import { strFromU8, unzipSync } from 'fflate'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { closeApp, launchApp, makePdf, openViaMain, seedModels, stubSaveDialog, tempDir } from './helpers'

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

const dir = tempDir('pdf-e2e')
let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  test.setTimeout(300_000)
  const userData = tempDir('pdf-profile')
  await seedModels(userData, ['ocr'])
  ;({ app, window } = await launchApp({ userData }))
})

test.afterAll(async () => {
  await closeApp(app)
})

function readFileSafe(path: string): Buffer | null {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

/** Exports the document as PDF and returns each page's size and text, read back with pdf.js. */
async function exportPdf(searchable: boolean, flatten = true): Promise<{ size: number[]; text: string }[]> {
  const out = join(dir, `export-${Date.now()}.pdf`)
  await stubSaveDialog(app, out)
  await window.keyboard.press('Control+e')
  const dialog = window.getByRole('dialog')
  await dialog.getByLabel('Format').selectOption('pdf')
  const check = dialog.getByLabel(/Make scanned pages searchable/)
  if ((await check.isChecked()) !== searchable) await check.click()
  const removeReplaced = dialog.getByLabel(/Remove replaced text/)
  if ((await removeReplaced.count()) && (await removeReplaced.isChecked()) !== flatten)
    await removeReplaced.click()
  await dialog.getByRole('button', { name: 'Export' }).click()
  await expect.poll(() => readFileSafe(out), { timeout: 120_000 }).not.toBeNull()
  await expect(window.getByTestId('task-bar')).toBeHidden({ timeout: 120_000 })
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(out)) }).promise
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push({
      size: [Math.round(page.view[2] ?? 0), Math.round(page.view[3] ?? 0)],
      text: content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
    })
  }
  return pages
}

test('exports an edited PDF: original pages keep their text, new text is real text', async () => {
  const source = join(dir, 'brochure.pdf')
  writeFileSync(source, makePdf(['Page one', 'Page two']))
  await openViaMain(app, source)
  await expect(window.getByTestId('doc-name')).toHaveText('brochure')
  const box = await window.getByTestId('canvas').boundingBox()
  if (!box) throw new Error('canvas not visible')
  await window.keyboard.press('t')
  await window.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await window.keyboard.type('Added in Studio')
  await window.keyboard.press('Escape')

  const pages = await exportPdf(false)
  expect(pages).toHaveLength(2)
  expect(pages.map((p) => p.size)).toEqual([
    [612, 792],
    [612, 792]
  ])
  expect(pages[0]?.text).toContain('Page one')
  expect(pages[0]?.text).toContain('Added in Studio')
  expect(pages[1]?.text).toContain('Page two')
})

test('reads a PDF page’s own text exactly and converts it with its font', async () => {
  await window.keyboard.press('Escape')
  await window.keyboard.press('d')
  const bar = window.getByTestId('detect-bar')
  await expect(bar).toContainText('1 text line found', { timeout: 30_000 })
  await bar.getByRole('button', { name: 'Convert all' }).click()
  await expect(bar).toBeHidden({ timeout: 60_000 })

  const out = join(dir, 'converted.cmsp')
  await stubSaveDialog(app, out)
  await window.keyboard.press('Control+Shift+s')
  await expect.poll(() => readFileSafe(out)).not.toBeNull()
  const doc = JSON.parse(strFromU8(unzipSync(readFileSync(out))['document.json'] as Uint8Array)) as {
    pages: { layers: { text?: string; fontFamily?: string; fontSize?: number; origin?: string }[] }[]
  }
  // Helvetica 24 pt in the PDF: Arial (its Windows equivalent) at 24 pt = 48 page units.
  expect(doc.pages[0]?.layers.find((l) => l.text === 'Page one')).toMatchObject({
    fontFamily: 'Arial',
    fontSize: 48,
    origin: 'pdf-native'
  })
})

test('removes replaced PDF text from the export unless asked to keep pages as vectors', async () => {
  const count = (text: string | undefined) => (text ?? '').split('Page one').length - 1
  const flattened = await exportPdf(false, true)
  expect(count(flattened[0]?.text)).toBe(1) // only the new, editable text
  expect(flattened[1]?.text).toContain('Page two') // untouched page still vector text
  const kept = await exportPdf(false, false)
  expect(count(kept[0]?.text)).toBe(2) // the original stays in the copied page, under the patch
})

test('makes an image searchable when exported as PDF', async () => {
  // Saved by the previous test, so it closes without asking.
  await window.getByRole('button', { name: 'Close document' }).click()
  await openViaMain(app, resolve('tests/fixtures/ocr-poster.png'))
  await expect(window.getByTestId('doc-name')).toHaveText('ocr-poster')
  const [page] = await exportPdf(true)
  expect(page?.text).toContain('CallMissed Studio')
  expect(page?.text).toContain('SUMMER SALE')
})

test('reorders, deletes and restores pages, and exports them in the new order', async () => {
  // The searchable-export test saved nothing, but its document is unchanged: closes without asking.
  await window.getByRole('button', { name: 'Close document' }).click()
  const source = join(dir, 'chapters.pdf')
  writeFileSync(source, makePdf(['Chapter One', 'Chapter Two', 'Chapter Three']))
  await openViaMain(app, source)
  await expect(window.getByTestId('doc-name')).toHaveText('chapters')
  await window.getByRole('tab', { name: /Pages/ }).click()
  const order = async () => (await exportPdf(false)).map((p) => p.text.trim())

  await window.getByRole('button', { name: 'Page 1' }).click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Move down' }).click()
  expect(await order()).toEqual(['Chapter Two', 'Chapter One', 'Chapter Three'])

  await window.getByTestId('page-item').nth(2).dragTo(window.getByTestId('page-item').nth(0))
  expect(await order()).toEqual(['Chapter Three', 'Chapter Two', 'Chapter One'])

  await window.getByRole('button', { name: 'Page 2' }).click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Delete page' }).click()
  expect(await order()).toEqual(['Chapter Three', 'Chapter One'])

  await window.keyboard.press('Control+z')
  expect(await order()).toEqual(['Chapter Three', 'Chapter Two', 'Chapter One'])
})

test('uses the PDF’s own installed font and skips invisible text', async () => {
  await window.getByRole('button', { name: 'Close document' }).click()
  const dontSave = window.getByRole('button', { name: 'Don’t save' })
  if (await dontSave.isVisible().catch(() => false)) await dontSave.click()
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  // Comic Sans MS ships with Windows but is not in the editor's font list.
  const comic = await doc.embedFont(readFileSync('C:/Windows/Fonts/comic.ttf'), { subset: true })
  const page = doc.addPage([500, 300])
  page.drawText('Party at seven', { x: 40, y: 220, size: 28, font: comic })
  // An invisible OCR-style line over blank paper: nothing to edit there.
  page.drawText('hidden search text', {
    x: 40,
    y: 80,
    size: 14,
    font: comic,
    renderMode: TextRenderingMode.Invisible
  })
  const source = join(dir, 'invite.pdf')
  writeFileSync(source, await doc.save())
  await openViaMain(app, source)
  await expect(window.getByTestId('doc-name')).toHaveText('invite')

  await window.keyboard.press('d')
  const bar = window.getByTestId('detect-bar')
  await expect(bar).toContainText('1 text line found', { timeout: 30_000 })
  await bar.getByRole('button', { name: 'Convert all' }).click()
  await expect(bar).toBeHidden({ timeout: 60_000 })
  const out = join(dir, 'invite.cmsp')
  await stubSaveDialog(app, out)
  await window.keyboard.press('Control+Shift+s')
  await expect.poll(() => readFileSafe(out)).not.toBeNull()
  const saved = JSON.parse(strFromU8(unzipSync(readFileSync(out))['document.json'] as Uint8Array)) as {
    pages: { layers: { text?: string; fontFamily?: string }[] }[]
  }
  expect(saved.pages[0]?.layers.map((l) => [l.text, l.fontFamily])).toEqual([
    ['Party at seven', 'Comic Sans MS']
  ])
})
