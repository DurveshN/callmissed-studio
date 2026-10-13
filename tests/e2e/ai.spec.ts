import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readPng } from '../fixtures/png'
import { closeApp, launchApp, makePng, openViaMain, stubSaveDialog, tempDir } from './helpers'

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const KEY = 'cm_testkey12345'
const RESULT = makePng(96, 64, [20, 160, 90]) // the "generated" picture: solid green
const dir = tempDir('ai-e2e')
const requests: { path: string; auth: string | undefined; body: Record<string, unknown> | null }[] = []

/** A stand-in for api.callmissed.com (the app is pointed at it with STUDIO_CALLMISSED_URL). */
function fakeCallMissed(): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString()
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
      const path = req.url ?? ''
      requests.push({ path, auth: req.headers.authorization, body })
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      // Shapes as served by api.callmissed.com (public catalogue and plan access).
      const model = (id: string, price: number, owner: string, extra = {}) => ({
        id,
        name: id,
        description: `${id} from ${owner}`,
        category: 'image',
        owned_by: owner,
        pricing: { price, unit: 'per_image', currency: 'USD' },
        free: false,
        min_plan: null,
        ...extra
      })
      if (path === '/api/v1/models?category=image') {
        return send(200, {
          object: 'list',
          total: 4,
          data: [
            model('gpt-image-2', 0.2604, 'openai'),
            model('gpt-image-1.5', 0.2604, 'openai', { status: 'maintenance', status_message: 'Back soon' }),
            model('nano-banana-2', 0.06979, 'google'),
            model('flux-2-klein-9b', 0.1042, 'black-forest-labs', { free: true })
          ]
        })
      }
      if (path === '/api/v1/models/access') {
        const starter = ['flux-2-klein-9b', 'gpt-image-2', 'gpt-image-1.5', 'nano-banana-2']
        return send(200, {
          plans: {
            free: { models: [], by_category: { image: ['flux-2-klein-9b'] }, restriction: '' },
            starter: { models: [], by_category: { image: starter }, restriction: '' },
            pro: { models: [], by_category: { image: starter }, restriction: '' }
          }
        })
      }
      if (req.headers.authorization !== `Bearer ${KEY}`)
        return send(401, { error: { message: 'Invalid API key' } })
      // This key can use the GPT models but not nano-banana-2.
      if (path === '/v1/models') {
        return send(200, { object: 'list', data: [{ id: 'gpt-image-2' }, { id: 'gpt-image-1.5' }] })
      }
      if (path === '/v1/images/generations') {
        if (String(body?.['prompt']).includes('broke')) {
          return send(402, {
            error: {
              message: 'Insufficient credits (balance: 0.0)',
              type: 'insufficient_quota',
              code: 'insufficient_credits'
            }
          })
        }
        const n = Number(body?.['n'] ?? 1)
        return send(200, {
          created: 1,
          data: Array.from({ length: n }, () => ({
            b64_json: RESULT.toString('base64'),
            revised_prompt: null
          }))
        })
      }
      send(404, { error: { code: 'not_found', message: 'Not found' } })
    })
  })
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)))
}

let server: Server
let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  server = await fakeCallMissed()
  const { port } = server.address() as AddressInfo
  ;({ app, window } = await launchApp({ env: { STUDIO_CALLMISSED_URL: `http://127.0.0.1:${port}` } }))
  await openViaMain(app, resolve('tests/fixtures/ocr-poster.png'))
  await expect(window.getByTestId('doc-name')).toHaveText('ocr-poster')
})

test.afterAll(async () => {
  await closeApp(app)
  server.close()
})

function readFileSafe(path: string): Buffer | null {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

const bar = () => window.getByTestId('prompt-bar')

test('asks for a CallMissed key, stores it and checks it works', async () => {
  await bar().getByRole('button', { name: 'Add API key' }).click()
  const settings = window.getByTestId('callmissed-settings')
  await settings.getByLabel('CallMissed API key').fill(KEY)
  await settings.getByRole('button', { name: 'Save key' }).click()
  await expect(settings).toContainText('The key works.')
  await expect(settings).toContainText('cm_…2345')
  await window.getByRole('button', { name: 'Done' }).click()
  // Only main ever sent the key; the requests carried it as a bearer token.
  expect(requests.some((r) => r.path === '/v1/models' && r.auth === `Bearer ${KEY}`)).toBe(true)
})

test('shows the cost, sends the page as the reference and keeps the results', async () => {
  // The models come from CallMissed for this key: names, prices, plan and availability.
  await bar().getByRole('button', { name: 'AI model' }).click()
  const picker = window.getByTestId('model-picker')
  const options = picker.getByTestId('model-option')
  await expect(options).toHaveCount(3) // flux cannot edit pictures, so it is not offered
  await expect(options.filter({ hasText: 'GPT Image 2' })).toContainText('25 credits / image')
  await expect(options.filter({ hasText: 'GPT Image 2' })).toContainText('Starter+')
  await expect(options.filter({ hasText: 'GPT Image 1.5' })).toBeDisabled() // under maintenance
  await expect(options.filter({ hasText: 'GPT Image 1.5' })).toContainText('Back soon')
  await expect(options.filter({ hasText: 'Nano Banana 2' })).toContainText('Not available for this API key')
  await options.filter({ hasText: 'GPT Image 2' }).click()
  await expect(picker).toBeHidden()

  await bar().getByRole('radio', { name: '2 images' }).click()
  await expect(window.getByTestId('ai-cost')).toHaveText('50 credits')
  await bar().getByLabel('AI prompt').fill('Make the background a sunset')
  await bar()
    .getByRole('button', { name: /Generate/ })
    .click()
  await expect(window.getByTestId('ai-result')).toHaveCount(2, { timeout: 30_000 })
  await expect(window.getByRole('tab', { name: 'AI (2)' })).toHaveAttribute('aria-selected', 'true')

  const sent = requests.find((r) => r.path === '/v1/images/generations')
  expect(sent?.body).toMatchObject({
    model: 'gpt-image-2',
    prompt: 'Make the background a sunset',
    n: 2,
    response_format: 'b64_json'
  })
  expect(String((sent?.body?.['reference_images'] as string[])[0])).toMatch(/^data:image\/png;base64,iVBOR/)
})

test('compares a result and uses it as the page, undoably, without losing results', async () => {
  await window.getByTestId('ai-result').first().getByRole('button', { name: 'Compare' }).click()
  await expect(window.getByTestId('compare-bar')).toBeVisible()
  await window.getByTestId('compare-bar').getByRole('button', { name: 'Use as page' }).click()
  await expect(window.getByTestId('compare-bar')).toBeHidden()
  await expect(window.getByRole('button', { name: /^Undo Use AI result as page/ })).toBeVisible()

  const out = join(dir, 'page.png')
  await stubSaveDialog(app, out)
  await window.keyboard.press('Control+e')
  await window.getByRole('dialog').getByRole('button', { name: 'Export' }).click()
  await expect.poll(() => readFileSafe(out)).not.toBeNull()
  const png = readPng(out)
  const mid = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4
  expect(Array.from(png.data.subarray(mid, mid + 3))).toEqual([20, 160, 90])

  await window.keyboard.press('Escape')
  await window.keyboard.press('Control+z')
  await expect(window.getByTestId('ai-result')).toHaveCount(2) // undo never removes paid results
})

test('adds a result as a layer', async () => {
  await window.getByTestId('ai-result').first().getByRole('button', { name: 'Add as layer' }).click()
  await expect(window.getByRole('button', { name: /^Undo Add AI result/ })).toBeVisible()
})

test('explains API failures in plain words', async () => {
  await bar().getByLabel('AI prompt').fill('This will be broke')
  await bar()
    .getByRole('button', { name: /Generate/ })
    .click()
  await expect(window.getByText(/Not enough CallMissed credits/)).toBeVisible({ timeout: 30_000 })
  await expect(window.getByTestId('ai-result')).toHaveCount(2)
})

test('shows usage and keeps results with the saved project', async () => {
  await window.getByRole('tab', { name: 'Usage' }).click()
  const usage = window.getByTestId('ai-usage')
  await expect(usage).toContainText('50 credits')
  await expect(usage).toContainText('1 failed (not charged)')

  const out = join(dir, 'with-ai.cmsp')
  await stubSaveDialog(app, out)
  await window.keyboard.press('Control+Shift+s')
  await expect.poll(() => readFileSafe(out)).not.toBeNull()
  const files = unzipSync(readFileSync(out))
  const doc = JSON.parse(strFromU8(files['document.json'] as Uint8Array)) as {
    generations: { assetId: string; prompt: string }[]
  }
  expect(doc.generations.map((g) => g.prompt)).toEqual([
    'Make the background a sunset',
    'Make the background a sunset'
  ])
  for (const g of doc.generations) expect(files[`assets/${g.assetId}.png`]).toBeDefined()

  await window.getByRole('button', { name: 'Close document' }).click()
  await openViaMain(app, out)
  await expect(window.getByRole('tab', { name: 'AI (2)' })).toBeVisible()
})
