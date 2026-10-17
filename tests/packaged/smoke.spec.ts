import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { version } from '../../package.json'
import { closeApp, seedModels, stubSaveDialog, tempDir } from '../e2e/helpers'

/**
 * Smoke test of the packaged app (release/<version>/win-unpacked), run after `npm run dist`:
 * the things that only break once packaged — native ONNX Runtime outside the asar, the ML
 * utilityProcess, bundled fonts read from inside the asar for PDF export.
 */
const exe = resolve(`release/${version}/win-unpacked/CallMissed Studio.exe`)

test('the installed app opens a picture, recognizes its text and exports a PDF with real text', async () => {
  test.setTimeout(300_000)
  expect(existsSync(exe), `${exe} missing: run npm run dist first`).toBe(true)
  // A throwaway profile (test-only env overrides are ignored by packaged builds; this is Chromium's switch).
  const userData = tempDir('packaged-profile')
  await seedModels(userData, ['ocr'])
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ gpu: 'auto', modelSetupDone: true }))
  const app = await electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${userData}`, resolve('tests/fixtures/ocr-poster.png')]
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('doc-name')).toHaveText('ocr-poster', { timeout: 60_000 })
    expect(await app.evaluate(({ app: a }) => [a.isPackaged, a.getVersion()])).toEqual([true, version])

    await window.keyboard.press('d')
    const bar = window.getByTestId('detect-bar')
    await expect(bar).toContainText('5 text lines found', { timeout: 120_000 })
    await bar.getByRole('button', { name: 'Convert all' }).click()
    await expect(bar).toBeHidden({ timeout: 120_000 })

    const out = join(tempDir('packaged-out'), 'poster.pdf')
    await stubSaveDialog(app, out)
    await window.keyboard.press('Control+e')
    const dialog = window.getByRole('dialog')
    await dialog.getByLabel('Format').selectOption('pdf')
    const searchable = dialog.getByLabel(/Make scanned pages searchable/)
    if (await searchable.isChecked()) await searchable.click()
    await dialog.getByRole('button', { name: 'Export' }).click()
    await expect.poll(() => existsSync(out), { timeout: 60_000 }).toBe(true)
    const pdf = await getDocument({ data: new Uint8Array(readFileSync(out)) }).promise
    const text = (await (await pdf.getPage(1)).getTextContent()).items
      .map((i) => ('str' in i ? i.str : ''))
      .join(' ')
    expect(text).toContain('CallMissed Studio')
  } finally {
    await closeApp(app)
  }
})
