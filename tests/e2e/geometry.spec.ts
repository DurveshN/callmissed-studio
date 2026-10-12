import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readPng } from '../fixtures/png'
import { closeApp, launchApp, makePng, openViaMain, stubOpenDialog, stubSaveDialog, tempDir } from './helpers'

test.describe.configure({ mode: 'serial' })

// 400×300 picture in four quadrants: red | green over blue | white.
const W = 400
const H = 300
const RED = [230, 30, 30]
const GREEN = [30, 200, 60]
const BLUE = [30, 60, 230]
const WHITE = [255, 255, 255]
const dir = tempDir('geometry-e2e')
const picture = join(dir, 'quadrants.png')
writeFileSync(
  picture,
  makePng(
    W,
    H,
    (x, y) => (y < H / 2 ? (x < W / 2 ? RED : GREEN) : x < W / 2 ? BLUE : WHITE) as [number, number, number]
  )
)

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  ;({ app, window } = await launchApp())
  await openViaMain(app, picture)
  await expect(window.getByTestId('doc-name')).toHaveText('quadrants')
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

async function exported() {
  const out = join(dir, `export-${Date.now()}.png`)
  await stubSaveDialog(app, out)
  await window.keyboard.press('Control+e')
  await window.getByRole('dialog').getByRole('button', { name: 'Export' }).click()
  await expect.poll(() => readFileSafe(out)).not.toBeNull()
  const png = readPng(out)
  return {
    width: png.width,
    height: png.height,
    at: (x: number, y: number) =>
      Array.from(png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3))
  }
}

const near = (actual: number[], expected: number[]) =>
  expect(Math.max(...actual.map((v, i) => Math.abs(v - (expected[i] as number))))).toBeLessThanOrEqual(12)

/** Screen position of a page point; the page is shown at 100%, centred. */
async function onPage(x: number, y: number, pageWidth: number, pageHeight: number) {
  const box = await window.getByTestId('canvas').boundingBox()
  if (!box) throw new Error('canvas not visible')
  return { x: box.x + box.width / 2 + x - pageWidth / 2, y: box.y + box.height / 2 + y - pageHeight / 2 }
}

test('turns the page and its picture 90° right, undone in one step', async () => {
  await window.getByTestId('page-section').getByRole('button', { name: 'Rotate page right' }).click()
  await expect(window.getByRole('button', { name: /^Undo Rotate page right/ })).toBeVisible()
  const png = await exported()
  expect([png.width, png.height]).toEqual([H, W])
  near(png.at(50, 50), BLUE) // the bottom-left quadrant is now top-left
  near(png.at(250, 50), RED)
  near(png.at(250, 350), GREEN)
  await window.keyboard.press('Control+z')
  expect((await exported()).width).toBe(W)
})

test('resizes the page with its aspect ratio kept', async () => {
  const width = window.getByTestId('page-section').getByLabel('Width')
  await width.fill('200')
  await width.press('Enter')
  const png = await exported()
  expect([png.width, png.height]).toEqual([200, 150])
  near(png.at(25, 25), RED)
  near(png.at(175, 125), WHITE)
  await window.keyboard.press('Control+z')
})

test('crops the page to the dragged box', async () => {
  await window.keyboard.press('Control+1')
  await window.keyboard.press('c')
  await expect(window.getByTestId('crop-bar')).toBeVisible()
  // Drag the top-left handle to the page centre: only the bottom-right quadrant stays.
  const from = await onPage(0, 0, W, H)
  const to = await onPage(W / 2, H / 2, W, H)
  await window.mouse.move(from.x, from.y)
  await window.mouse.down()
  await window.mouse.move(to.x, to.y, { steps: 8 })
  await window.mouse.up()
  await window.getByTestId('crop-bar').getByRole('button', { name: 'Apply' }).click()
  await expect(window.getByRole('button', { name: /^Undo Crop page/ })).toBeVisible()
  const png = await exported()
  expect([png.width, png.height]).toEqual([W / 2, H / 2])
  near(png.at(10, 10), WHITE)
  await window.keyboard.press('Control+z')
})

test('crops an image layer, keeping the kept part in place', async () => {
  await stubOpenDialog(app, picture)
  await window.keyboard.press('i')
  await expect(window.getByRole('button', { name: 'Crop image' })).toBeVisible()
  await window.getByRole('button', { name: 'Crop image' }).click()
  // The inserted layer is centred at 60% size: 240×180 at (80, 60). Drag its top-left handle to its centre.
  await window.keyboard.press('Control+1')
  const from = await onPage(80, 60, W, H)
  const to = await onPage(200, 150, W, H)
  await window.mouse.move(from.x, from.y)
  await window.mouse.down()
  await window.mouse.move(to.x, to.y, { steps: 8 })
  await window.mouse.up()
  await window.keyboard.press('Enter')
  await expect(window.getByRole('button', { name: /^Undo Crop image/ })).toBeVisible()

  const out = join(dir, 'layer.cmsp')
  await stubSaveDialog(app, out)
  await window.keyboard.press('Control+Shift+s')
  await expect.poll(() => readFileSafe(out)).not.toBeNull()
  const files = unzipSync(readFileSync(out))
  const doc = JSON.parse(strFromU8(files['document.json'] as Uint8Array)) as {
    pages: { layers: { x: number; y: number; width: number; height: number; assetId: string }[] }[]
  }
  const layer = doc.pages[0]?.layers[0]
  expect(layer).toMatchObject({ x: expect.closeTo(200, 0), y: expect.closeTo(150, 0) })
  expect(layer?.width).toBeCloseTo(120, 0)
  expect(layer?.height).toBeCloseTo(90, 0)
  // The kept pixels are the source's bottom-right quadrant at full resolution.
  const asset = join(dir, 'cropped.png')
  writeFileSync(asset, files[`assets/${layer?.assetId}.png`] as Uint8Array)
  const png = readPng(asset)
  expect([png.width, png.height]).toEqual([W / 2, H / 2])
})
