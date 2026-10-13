import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CallMissedClient } from '../../src/main/services/callmissed-client'
import { LibraryDb, type ApiCall } from '../../src/main/services/library-db'
import { SecretStore, type Cipher } from '../../src/main/services/secret-store'
import { StudioError } from '../../src/shared/ipc/result'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 1])

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })
}

function client(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
  key: string | null = 'cm_testkey123'
) {
  const calls: ApiCall[] = []
  const requests: { url: string; init: RequestInit }[] = []
  const fetch = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    requests.push({ url: String(url), init })
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    return respond(String(url), init)
  })
  const api = new CallMissedClient({
    fetch: fetch as unknown as typeof globalThis.fetch,
    getKey: async () => key,
    log: (c) => calls.push(c)
  })
  return { api, calls, requests }
}

const generate = {
  model: 'gpt-image-2',
  prompt: 'make it blue',
  n: 2,
  size: '1536x1024',
  reference: new Uint8Array(PNG),
  creditsPerImage: 25
}

async function failure(promise: Promise<unknown>): Promise<StudioError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof StudioError) return error
    throw error
  }
  throw new Error('expected a failure')
}

const header = (init: RequestInit | undefined, name: string) =>
  (init?.headers as Record<string, string> | undefined)?.[name]

describe('CallMissed client', () => {
  it('sends the page as a reference image and returns the generated pictures', async () => {
    const { api, calls, requests } = client(() =>
      json(200, {
        created: 1,
        data: [
          { b64_json: PNG.toString('base64'), revised_prompt: 'blue' },
          { b64_json: JPEG.toString('base64') }
        ]
      })
    )
    const images = await api.generate(generate)
    expect(images.map((i) => [i.mime, i.revisedPrompt])).toEqual([
      ['image/png', 'blue'],
      ['image/jpeg', null]
    ])
    const sent = requests[0]
    expect(sent?.url).toBe('https://api.callmissed.com/v1/images/generations')
    expect(header(sent?.init, 'Authorization')).toBe('Bearer cm_testkey123')
    expect(header(sent?.init, 'Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.parse(String(sent?.init.body))).toEqual({
      model: 'gpt-image-2',
      prompt: 'make it blue',
      n: 2,
      size: '1536x1024',
      response_format: 'b64_json',
      reference_images: [`data:image/png;base64,${PNG.toString('base64')}`]
    })
    expect(calls).toMatchObject([
      {
        endpoint: 'images/generations',
        model: 'gpt-image-2',
        httpStatus: 200,
        errorCode: null,
        images: 2,
        credits: 50
      }
    ])
  })

  it('asks for a key before calling the API', async () => {
    const { api, requests } = client(() => json(200, {}), null)
    expect((await failure(api.generate(generate))).message).toMatch(/Add your CallMissed API key/)
    expect(requests).toHaveLength(0)
  })

  it.each([
    [
      402,
      { error: { code: 'insufficient_credits', message: 'Insufficient credits' } },
      {},
      /Not enough CallMissed credits/
    ],
    [403, { error: { code: 'permission_denied', message: 'x' } }, {}, /"image" permission/],
    [400, { error: { code: 'content_policy_violation', message: 'x' } }, {}, /no credits were used/],
    [
      429,
      { error: { code: 'rate_limit_exceeded', message: 'x' } },
      { 'Retry-After': '7' },
      /Try again in 7 s\./
    ],
    [429, { error: { code: 'quota_exceeded', message: 'x' } }, {}, /monthly image limit/],
    [503, { error: { code: 'upstream_error', message: 'x' } }, {}, /no credits were used/],
    [401, { error: { message: 'bad key' } }, {}, /did not accept the API key/],
    [
      422,
      { detail: [{ loc: ['body', 'n'], msg: 'Input should be less than or equal to 4', type: 'x' }] },
      {},
      /less than or equal to 4/
    ],
    [418, { error: { code: 'something_new', message: 'Teapot' } }, {}, /CallMissed: Teapot/]
  ])('explains HTTP %i failures and logs them', async (status, body, headers, message) => {
    const { api, calls } = client(() => json(status, body, headers))
    const error = await failure(api.generate(generate))
    expect(error.code).toBe('API')
    expect(error.message).toMatch(message)
    expect(calls[0]).toMatchObject({ httpStatus: status, images: 0, credits: 0 })
    expect(calls[0]?.errorCode).toBeTruthy()
  })

  it('reports network failures and cancellation without charging', async () => {
    const offline = client(() => {
      throw new TypeError('fetch failed')
    })
    expect((await failure(offline.api.generate(generate))).message).toMatch(/Could not reach CallMissed/)
    expect(offline.calls[0]).toMatchObject({ httpStatus: null, errorCode: 'network' })

    const controller = new AbortController()
    controller.abort()
    const cancelled = client(() => json(200, { data: [] }))
    expect((await failure(cancelled.api.generate(generate, controller.signal))).code).toBe('CANCELLED')
    expect(cancelled.calls[0]).toMatchObject({ errorCode: 'cancelled', credits: 0 })
  })

  it('reads the account history page by page', async () => {
    const { api, requests } = client(() =>
      json(200, {
        data: [
          {
            id: 'img_1',
            url: 'https://cdn.example/img_1.png',
            model: 'gpt-image-2',
            size: '1024x1024',
            prompt: 'p',
            negative_prompt: null,
            revised_prompt: null,
            seed: 1,
            steps: null,
            created: 1700000000
          }
        ],
        next_cursor: '2026-10-01T00:00:00Z'
      })
    )
    const page = await api.history('2026-10-12T00:00:00Z', 10)
    expect(page.items).toEqual([
      {
        id: 'img_1',
        url: 'https://cdn.example/img_1.png',
        model: 'gpt-image-2',
        size: '1024x1024',
        prompt: 'p',
        revisedPrompt: null,
        created: 1700000000
      }
    ])
    expect(page.nextCursor).toBe('2026-10-01T00:00:00Z')
    expect(requests[0]?.url).toBe(
      'https://api.callmissed.com/v1/images/history?limit=10&before=2026-10-12T00%3A00%3A00Z'
    )
  })

  it('reads the public catalogue and plan access without a key, and the key’s own list with it', async () => {
    const { api, requests } = client((url) => {
      if (url.endsWith('/api/v1/models?category=image')) {
        return json(200, {
          object: 'list',
          total: 2,
          data: [
            {
              id: 'gpt-image-2',
              name: 'gpt-image-2',
              description: 'OpenAI GPT Image 2',
              category: 'image',
              owned_by: 'openai',
              pricing: { price: 0.2604, unit: 'per_image', currency: 'USD' },
              free: false,
              min_plan: null
            },
            {
              id: 'flux-1.1-pro',
              status: 'maintenance',
              status_message: 'Back soon',
              pricing: { price: 0.05208 }
            }
          ]
        })
      }
      if (url.endsWith('/api/v1/models/access')) {
        return json(200, {
          plans: {
            free: { models: [], by_category: { image: ['flux-2-klein-9b'] }, restriction: '' },
            starter: {
              models: [],
              by_category: { image: ['flux-2-klein-9b', 'gpt-image-2'] },
              restriction: ''
            }
          }
        })
      }
      return json(200, { object: 'list', data: [{ id: 'gpt-image-2' }, { id: 'sarvam-105b' }] })
    })
    expect(await api.catalogue()).toEqual([
      {
        id: 'gpt-image-2',
        name: 'gpt-image-2',
        description: 'OpenAI GPT Image 2',
        ownedBy: 'openai',
        priceUsd: 0.2604,
        free: false,
        status: null,
        statusMessage: null
      },
      {
        id: 'flux-1.1-pro',
        name: 'flux-1.1-pro',
        description: '',
        ownedBy: '',
        priceUsd: 0.05208,
        free: false,
        status: 'maintenance',
        statusMessage: 'Back soon'
      }
    ])
    expect(await api.planAccess()).toEqual({
      free: ['flux-2-klein-9b'],
      starter: ['flux-2-klein-9b', 'gpt-image-2']
    })
    expect([...(await api.keyModels())]).toEqual(['gpt-image-2', 'sarvam-105b'])
    expect(header(requests[0]?.init, 'Authorization')).toBeUndefined()
    expect(header(requests[1]?.init, 'Authorization')).toBeUndefined()
    expect(header(requests[2]?.init, 'Authorization')).toBe('Bearer cm_testkey123')
  })

  it('downloads only https PNG or JPEG images', async () => {
    const { api } = client(() => new Response(PNG))
    expect((await api.download('https://cdn.example/a.png')).mime).toBe('image/png')
    expect((await failure(api.download('http://cdn.example/a.png'))).message).toMatch(/https/)
    const html = client(() => new Response('<html>'))
    expect((await failure(html.api.download('https://cdn.example/a.png'))).message).toMatch(/PNG or JPEG/)
  })
})

describe('API key storage', () => {
  const cipher: Cipher = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`),
    decryptString: (b) => b.toString().replace(/^enc:/, '')
  }
  const file = () => join(mkdtempSync(join(tmpdir(), 'studio-secret-')), 'secrets.bin')

  it('keeps the key encrypted on disk and shows only a hint', async () => {
    const path = file()
    const store = new SecretStore(path, cipher)
    expect(await store.getKey()).toBeNull()
    await store.setKey('  cm_abcdefgh1234  ')
    expect(readFileSync(path).toString()).toBe('enc:cm_abcdefgh1234')
    expect(await store.getKey()).toBe('cm_abcdefgh1234')
    expect(await store.hint()).toBe('cm_…1234')
    await store.removeKey()
    expect(await store.hint()).toBeNull()
  })

  it('rejects things that are not CallMissed keys, and refuses without secure storage', async () => {
    await expect(new SecretStore(file(), cipher).setKey('sk-openai-style')).rejects.toThrow(/starts with cm_/)
    const insecure = new SecretStore(file(), { ...cipher, isEncryptionAvailable: () => false })
    await expect(insecure.setKey('cm_abcdefgh1234')).rejects.toThrow(/Secure storage is not available/)
  })
})

describe('usage log', () => {
  it('totals generations, images and credits per model', () => {
    const db = new LibraryDb(join(mkdtempSync(join(tmpdir(), 'studio-usage-')), 'library.db'))
    const call = (over: Partial<ApiCall>): ApiCall => ({
      endpoint: 'images/generations',
      model: 'gpt-image-2',
      httpStatus: 200,
      errorCode: null,
      images: 2,
      credits: 50,
      latencyMs: 9000,
      createdAt: new Date().toISOString(),
      ...over
    })
    db.logApiCall(call({}))
    db.logApiCall(call({ model: 'gpt-image-1.5', images: 1, credits: 25 }))
    db.logApiCall(call({ httpStatus: 402, errorCode: 'insufficient_credits', images: 0, credits: 0 }))
    db.logApiCall(call({ endpoint: 'images/history', images: 0, credits: 0 }))
    const usage = db.usage()
    expect(usage).toMatchObject({ generations: 2, failures: 1, images: 3, credits: 75 })
    expect(usage.byModel).toEqual([
      { model: 'gpt-image-2', images: 2, credits: 50 },
      { model: 'gpt-image-1.5', images: 1, credits: 25 }
    ])
    expect(usage.recent).toHaveLength(4)
    expect(db.schemaVersion).toBe(2)
    db.close()
  })
})
