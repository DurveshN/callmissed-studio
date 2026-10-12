import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readPng } from '../fixtures/png'
import { closeApp, launchApp, makePng, openViaMain, stubOpenDialog, stubSaveDialog, tempDir } from './helpers'

test.describe.configure({ mode: 'serial' })

const W = 400
const H = 300
const dir = tempDir('layers-e2e')
const page = join(dir, 'page.png')
writeFileSync(page, makePng(W, H, [240, 240, 240]))
const sticker = join(dir, 'sticker.png')

let app: ElectronApplication
let window: Page

interface Saved {
  pages: {
    width: number
    height: number
    background: { assetId: string }
    layers: { name: string; x: number; y: number; width: number; height: number; assetId: string }[]
  }[]
}

test.beforeAll(async () => {
  ;({ app, window } = await launchApp())
  await openViaMain(app, page)
  await expect(window.getByTestId('doc-name')).toHaveText('page')
  // A 300×200 PNG, transparent except a green rectangle at 50..250 × 50..150 (drawn by the app).
  const png = await window.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 300
    canvas.height = 200
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    ctx.fillStyle = '#1eb43c'
    ctx.fillRect(50, 50, 200, 100)
    return canvas.toDataURL('image/png').split(',')[1] as string
  })
  writeFileSync(sticker, Buffer.from(png, 'base64'))
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

async function saved(): Promise<Saved & { asset(id: string): ReturnType<typeof readPng> }> {
  const out = join(dir, `doc-${Date.now()}.cmsp`)
  await stubSaveDialog(app, out)
  await window.keyboard.press('Control+Shift+s')
  await expect.poll(() => readFileSafe(out)).not.toBeNull()
  const files = unzipSync(readFileSync(out))
  const doc = JSON.parse(strFromU8(files['document.json'] as Uint8Array)) as Saved
  return {
    ...doc,
    asset: (id) => {
      const path = join(dir, `${id}.png`)
      writeFileSync(path, files[`assets/${id}.png`] as Uint8Array)
      return readPng(path)
    }
  }
}

/** Screen position of a page point (page at 100%, centred). */
async function onPage(x: number, y: number) {
  const box = await window.getByTestId('canvas').boundingBox()
  if (!box) throw new Error('canvas not visible')
  return { x: box.x + box.width / 2 + x - W / 2, y: box.y + box.height / 2 + y - H / 2 }
}

test('erasing across the edge of a transparent image keeps it transparent, never dark', async () => {
  await stubOpenDialog(app, sticker)
  await window.keyboard.press('i')
  await expect(window.getByRole('button', { name: 'Set as background' })).toBeVisible()
  await window.keyboard.press('Control+1')
  // Inserted at 80% (240×160 at 80, 70): the green rectangle's right edge (image x 250) is page x 280.
  await window.keyboard.press('b')
  await window.getByLabel('Size').fill('30')
  const from = await onPage(280, 120)
  const to = await onPage(280, 180)
  await window.mouse.move(from.x, from.y)
  await window.mouse.down()
  await window.mouse.move(to.x, to.y, { steps: 8 })
  await window.mouse.up()
  await expect(window.getByRole('button', { name: /^Undo Erase/ })).toBeVisible({ timeout: 60_000 })
  await window.keyboard.press('Escape')

  const doc = await saved()
  const layer = doc.pages[0]?.layers[0]
  const png = doc.asset(layer?.assetId ?? '')
  const px = (x: number, y: number) =>
    Array.from(png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4))
  // Inside the stroke: green stays green and opaque on the rectangle, clear stays clear outside it.
  expect(px(238, 100)[1]).toBeGreaterThan(150)
  expect(px(238, 100)[3]).toBe(255)
  expect(px(265, 100)[3]).toBeLessThan(40)
  for (let y = 70; y < 130; y++) {
    for (let x = 230; x < 272; x++) {
      const [, g, , a] = px(x, y) as [number, number, number, number]
      if (a > 128) expect(g).toBeGreaterThan(120) // no dark opaque fill
    }
  }
})

test('makes an image layer the background, keeping everything in place', async () => {
  await window.getByRole('tab', { name: 'Layers' }).click()
  await window.getByTestId('layer-row').first().click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Set as background' }).click()
  await expect(window.getByRole('button', { name: /^Undo Set as background/ })).toBeVisible()
  const doc = await saved()
  const p = doc.pages[0]
  // The page is the sticker at its own size; the old page sits where it was, in the sticker's pixels.
  expect([p?.width, p?.height]).toEqual([300, 200])
  expect(p?.layers.map((l) => l.name)).toEqual(['Previous background'])
  expect(p?.layers[0]?.x).toBeCloseTo(-100, 3)
  expect(p?.layers[0]?.y).toBeCloseTo(-87.5, 3)
  expect(p?.layers[0]?.width).toBeCloseTo(500, 3)
})

test('makes the background a layer over a blank page', async () => {
  await window.keyboard.press('Escape')
  await window.getByRole('tab', { name: 'Inspector' }).click()
  await window.getByRole('button', { name: 'Make background a layer' }).click()
  await expect(window.getByRole('button', { name: /^Undo Make background a layer/ })).toBeVisible()
  const doc = await saved()
  const p = doc.pages[0]
  expect(p?.layers.map((l) => l.name)).toEqual(['Background', 'Previous background'])
  expect(p?.layers[0]).toMatchObject({ x: 0, y: 0, width: 300, height: 200 })
  const blank = doc.asset(p?.background.assetId ?? '')
  expect(Array.from(blank.data.subarray(0, 4))).toEqual([255, 255, 255, 255])
})
