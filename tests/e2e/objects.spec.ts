import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readPng } from '../fixtures/png'
import { closeApp, launchApp, makePng, openViaMain, seedModels, stubSaveDialog, tempDir } from './helpers'

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

// 400×300 white picture: red disc (r = 60) at (120, 150), blue square 260..360 × 100..200.
const W = 400
const H = 300
const dir = tempDir('objects-e2e')
const picture = join(dir, 'shapes.png')
writeFileSync(
  picture,
  makePng(W, H, (x, y) => {
    if ((x - 120) ** 2 + (y - 150) ** 2 < 3600) return [230, 30, 30]
    if (x >= 260 && x < 360 && y >= 100 && y < 200) return [30, 60, 230]
    return [255, 255, 255]
  })
)

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  test.setTimeout(600_000)
  const userData = tempDir('objects-profile')
  await seedModels(userData, ['ocr', 'segment', 'inpaint', 'remove-bg'])
  ;({ app, window } = await launchApp({ userData }))
  await openViaMain(app, picture)
  await expect(window.getByTestId('doc-name')).toHaveText('shapes')
  // Actual size keeps the page centred, so page coordinates map to screen pixels 1:1.
  await window.keyboard.press('Control+1')
})

test.afterAll(async () => {
  await closeApp(app)
})

/** Screen position of a page point (page shown at 100%, centred). */
async function onPage(x: number, y: number) {
  const box = await window.getByTestId('canvas').boundingBox()
  if (!box) throw new Error('canvas not visible')
  return { x: box.x + box.width / 2 + x - W / 2, y: box.y + box.height / 2 + y - H / 2 }
}

interface SavedDoc {
  pages: {
    patches: unknown[]
    layers: { name: string; x: number; y: number; width: number; height: number; assetId?: string }[]
  }[]
}

/** Saves a copy of the project and returns its document, plus a reader for its image assets. */
async function saved(): Promise<SavedDoc & { asset(id: string): ReturnType<typeof readPng> }> {
  const out = join(dir, `doc-${Date.now()}.cmsp`)
  await stubSaveDialog(app, out)
  await window.keyboard.press('Control+Shift+s')
  await expect.poll(() => readFileSafe(out)).not.toBeNull()
  const files = unzipSync(readFileSync(out))
  const doc = JSON.parse(strFromU8(files['document.json'] as Uint8Array)) as SavedDoc
  return {
    ...doc,
    asset: (id) => {
      const path = join(dir, `${id}.png`)
      writeFileSync(path, files[`assets/${id}.png`] as Uint8Array)
      return readPng(path)
    }
  }
}

function readFileSafe(path: string): Buffer | null {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

async function exported(): Promise<ReturnType<typeof readPng>> {
  const out = join(dir, `export-${Date.now()}.png`)
  await stubSaveDialog(app, out)
  await window.keyboard.press('Control+e')
  await window.getByRole('dialog').getByRole('button', { name: 'Export' }).click()
  // Wait for the file itself: an "Exported" toast from an earlier export may still be showing.
  await expect.poll(() => readFileSafe(out)).not.toBeNull()
  return readPng(out)
}

const bar = () => window.getByTestId('select-bar')

test('selects the clicked object and cuts it to its own layer', async () => {
  await window.keyboard.press('w')
  const disc = await onPage(120, 150)
  await window.mouse.click(disc.x, disc.y)
  await expect(bar().getByRole('button', { name: 'Cut to layer' })).toBeVisible({ timeout: 90_000 })
  await bar().getByRole('button', { name: 'Cut to layer' }).click()
  await expect(bar()).toBeHidden({ timeout: 90_000 })

  const doc = await saved()
  const [layer] = doc.pages[0]?.layers ?? []
  // The new layer sits exactly over the disc (plus a one-pixel soft edge); the hole was filled.
  expect(layer?.name).toBe('Object')
  expect(Math.abs((layer?.x ?? 0) - 60)).toBeLessThanOrEqual(2)
  expect(Math.abs((layer?.y ?? 0) - 90)).toBeLessThanOrEqual(2)
  expect(Math.abs((layer?.width ?? 0) - 121)).toBeLessThanOrEqual(3)
  expect(doc.pages[0]?.patches).toHaveLength(1)
})

test('removes a selected object with Delete, filling it from the background', async () => {
  await window.keyboard.press('Control+z')
  await window.keyboard.press('w')
  const square = await onPage(310, 150)
  await window.mouse.click(square.x, square.y)
  await expect(bar().getByRole('button', { name: 'Remove' })).toBeVisible({ timeout: 90_000 })
  await window.keyboard.press('Delete')
  // Done when the bar is back to its hint (the buttons hide as soon as applying starts).
  await expect(bar()).toContainText('Click an object', { timeout: 90_000 })
  await window.keyboard.press('Escape')

  const png = await exported()
  const at = (x: number, y: number) => Array.from(png.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3))
  for (const [x, y] of [
    [310, 150],
    [265, 105],
    [355, 195]
  ] as const) {
    for (const v of at(x, y)) expect(v).toBeGreaterThan(225) // white again
  }
  expect(at(120, 150)[0]).toBeGreaterThan(200) // the disc is untouched
  expect(at(120, 150)[1]).toBeLessThan(80)
})

test('erases what the brush paints over, in one undo step', async () => {
  await window.keyboard.press('b')
  await expect(window.getByTestId('eraser-bar')).toBeVisible()
  // A 300 px brush dabbed on the disc covers it completely; the fill comes from the white around it.
  await window.getByLabel('Size').fill('300')
  const disc = await onPage(120, 150)
  await window.mouse.click(disc.x, disc.y)
  await expect(window.getByRole('button', { name: /^Undo Erase/ })).toBeVisible({ timeout: 90_000 })
  await expect(window.getByTestId('eraser-bar')).toHaveAttribute('data-status', 'idle')
  await window.keyboard.press('Escape')

  const png = await exported()
  for (const [x, y] of [
    [120, 150],
    [70, 150],
    [120, 100]
  ] as const) {
    expect(png.data[(y * W + x) * 4 + 1]).toBeGreaterThan(220) // the red disc is gone
  }
})

test('removes the background of the page into a subject layer', async () => {
  // Back to the original picture (undo the erase and the removal).
  await window.keyboard.press('Control+z')
  await window.keyboard.press('Control+z')
  await window.getByRole('button', { name: /^Remove background/ }).click()
  await expect(window.getByTestId('task-bar')).toBeVisible()
  await expect(window.getByTestId('task-bar')).toBeHidden({ timeout: 150_000 })
  const doc = await saved()
  expect(doc.pages[0]?.layers.map((l) => l.name)).toEqual(['Subject'])

  // The subject keeps both shapes; the page behind it is blank.
  const png = await exported()
  const px = (x: number, y: number) => Array.from(png.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3))
  expect(px(120, 150)[1]).toBeLessThan(80) // red disc
  expect(px(310, 150)[2]).toBeGreaterThan(180) // blue square
  for (const v of px(20, 20)) expect(v).toBeGreaterThan(245) // white
})

test('lifts handwriting to an image layer holding just the ink', async () => {
  // A handwritten-looking line (bundled Caveat font) rendered by the app itself: no personal data.
  const png = await window.evaluate(async () => {
    await document.fonts.load('64px Caveat')
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 200
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 600, 200)
    ctx.fillStyle = '#1b2a6b'
    ctx.font = '64px Caveat'
    ctx.fillText('Kind regards, Alex', 60, 120)
    return canvas.toDataURL('image/png').split(',')[1] as string
  })
  const note = join(dir, 'note.png')
  writeFileSync(note, Buffer.from(png, 'base64'))
  // The previous test saved the document, so it closes without asking.
  await window.getByRole('button', { name: 'Close document' }).click()
  await openViaMain(app, note)
  await expect(window.getByTestId('doc-name')).toHaveText('note')

  await window.keyboard.press('d')
  const detect = window.getByTestId('detect-bar')
  await expect(detect.getByRole('button', { name: 'Lift handwriting' })).toBeVisible({ timeout: 90_000 })
  await detect.getByRole('button', { name: 'Lift handwriting' }).click()
  await expect(detect).toBeHidden({ timeout: 90_000 })

  const doc = await saved()
  const layers = doc.pages[0]?.layers ?? []
  expect(layers.map((l) => l.name)).toEqual(['Handwriting'])
  // The layer covers the writing (x 60.., baseline 120).
  expect(layers[0]?.x).toBeLessThan(70)
  expect((layers[0]?.x ?? 0) + (layers[0]?.width ?? 0)).toBeGreaterThan(450)
  expect(doc.pages[0]?.patches.length).toBeGreaterThan(0)

  // Just the ink: transparent around the letters, opaque on the strokes.
  const ink = doc.asset(layers[0]?.assetId ?? '')
  const alpha = Array.from({ length: ink.width * ink.height }, (_, i) => ink.data[i * 4 + 3] as number)
  expect(alpha[0]).toBe(0)
  const opaque = alpha.filter((a) => a > 200).length / alpha.length
  expect(opaque).toBeGreaterThan(0.03)
  expect(opaque).toBeLessThan(0.5)
})

test('adjusts the page picture non-destructively, exported and undone in one step', async () => {
  await window.keyboard.press('Escape')
  await window.keyboard.press('Escape')
  const brightness = window.getByTestId('adjust-section').getByLabel('Brightness')
  await brightness.fill('-50')
  await brightness.fill('-40')
  // Blank paper (no layer there) at the bottom-right of the 600×200 note.
  const corner = (png: ReturnType<typeof readPng>) => png.data[(190 * png.width + 590) * 4] as number
  expect(Math.abs(corner(await exported()) - (255 - 0.4 * 255))).toBeLessThanOrEqual(2)
  await expect(window.getByRole('button', { name: /^Undo Adjust/ })).toBeVisible()
  await window.keyboard.press('Control+z')
  expect(corner(await exported())).toBe(255)
})
