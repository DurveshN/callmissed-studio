import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
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
async function exportPdf(searchable: boolean): Promise<{ size: number[]; text: string }[]> {
  const out = join(dir, `export-${Date.now()}.pdf`)
  await stubSaveDialog(app, out)
  await window.keyboard.press('Control+e')
  const dialog = window.getByRole('dialog')
  await dialog.getByLabel('Format').selectOption('pdf')
  const check = dialog.getByLabel(/Make scanned pages searchable/)
  if ((await check.isChecked()) !== searchable) await check.click()
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

test('makes an image searchable when exported as PDF', async () => {
  await window.getByRole('button', { name: 'Close document' }).click()
  await window.getByRole('button', { name: 'Don’t save' }).click()
  await openViaMain(app, resolve('tests/fixtures/ocr-poster.png'))
  await expect(window.getByTestId('doc-name')).toHaveText('ocr-poster')
  const [page] = await exportPdf(true)
  expect(page?.text).toContain('CallMissed Studio')
  expect(page?.text).toContain('SUMMER SALE')
})
