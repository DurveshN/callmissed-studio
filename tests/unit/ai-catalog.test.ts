import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AiCatalog, displayName } from '../../src/main/services/ai-catalog'
import type { CallMissedClient, CatalogueModel } from '../../src/main/services/callmissed-client'

const entry = (id: string, priceUsd: number, over: Partial<CatalogueModel> = {}): CatalogueModel => ({
  id,
  name: id,
  description: `${id} description`,
  ownedBy: id.startsWith('gpt') ? 'openai' : 'google',
  priceUsd,
  free: false,
  status: null,
  statusMessage: null,
  ...over
})

function fakeClient(keyModels: string[] | Error) {
  return {
    catalogue: vi.fn(async () => [
      entry('gpt-image-2', 0.2604),
      entry('gpt-image-1.5', 0.2604, { status: 'maintenance', statusMessage: 'Back soon' }),
      entry('nano-banana-2', 0.06979),
      entry('flux-2-klein-9b', 0.1042, { free: true }) // cannot edit pictures: left out
    ]),
    planAccess: vi.fn(async () => ({
      free: ['flux-2-klein-9b'],
      starter: ['flux-2-klein-9b', 'gpt-image-2', 'gpt-image-1.5', 'nano-banana-2'],
      pro: ['flux-2-klein-9b', 'gpt-image-2', 'gpt-image-1.5', 'nano-banana-2']
    })),
    keyModels: vi.fn(async () => {
      if (keyModels instanceof Error) throw keyModels
      return new Set(keyModels)
    })
  }
}

const cacheFile = () => join(mkdtempSync(join(tmpdir(), 'studio-catalog-')), 'ai-models.json')

describe('AI model catalog', () => {
  it('builds the image-editing models for the key from CallMissed (names, prices, plans, availability)', async () => {
    const client = fakeClient(['gpt-image-2', 'gpt-image-1.5'])
    const catalog = new AiCatalog(
      cacheFile(),
      client as unknown as CallMissedClient,
      async () => 'cm_key_one_1234'
    )
    const { models, keyChecked } = await catalog.list()
    expect(keyChecked).toBe(true)
    expect(models.map((m) => [m.id, m.credits, m.minPlan, m.available, m.note, m.referenceMaxBytes])).toEqual(
      [
        ['gpt-image-2', 25, 'starter', true, null, 10 * 1024 * 1024],
        // Unavailable ones after, cheapest first.
        ['nano-banana-2', 6.7, 'starter', false, 'Not available for this API key', 7 * 1024 * 1024],
        ['gpt-image-1.5', 25, 'starter', false, 'Back soon', 10 * 1024 * 1024]
      ]
    )
    expect(models[0]).toMatchObject({
      name: 'GPT Image 2',
      provider: 'openai',
      description: 'gpt-image-2 description'
    })
  })

  it('keeps the list until the key changes or a refresh is asked for', async () => {
    let key = 'cm_key_one_1234'
    const client = fakeClient(['gpt-image-2'])
    const file = cacheFile()
    const catalog = new AiCatalog(file, client as unknown as CallMissedClient, async () => key)
    await catalog.list()
    await catalog.list()
    expect(client.catalogue).toHaveBeenCalledTimes(1)
    // Stored on disk with a fingerprint of the key, never the key itself.
    const stored = readFileSync(file, 'utf8')
    expect(stored).not.toContain('cm_key_one_1234')

    // A fresh app start reads the cache instead of calling the API.
    const restarted = new AiCatalog(file, client as unknown as CallMissedClient, async () => key)
    await restarted.list()
    expect(client.catalogue).toHaveBeenCalledTimes(1)

    key = 'cm_key_two_5678'
    await restarted.list()
    expect(client.catalogue).toHaveBeenCalledTimes(2)
    await restarted.list(true)
    expect(client.catalogue).toHaveBeenCalledTimes(3)
  })

  it('still lists the models when the key’s own list cannot be read (marked as not checked)', async () => {
    const catalog = new AiCatalog(
      cacheFile(),
      fakeClient(new Error('offline')) as unknown as CallMissedClient,
      async () => 'cm_key_one_1234'
    )
    const { models, keyChecked } = await catalog.list()
    expect(keyChecked).toBe(false)
    expect(models.filter((m) => m.available).map((m) => m.id)).toEqual(['nano-banana-2', 'gpt-image-2'])
  })

  it('shows slug names readably and keeps real ones', () => {
    expect(displayName('gpt-image-2.5-sunburst')).toBe('GPT Image 2.5 Sunburst')
    expect(displayName('nano-banana-pro')).toBe('Nano Banana Pro')
    expect(displayName('gemini-3.1-flash-lite-image')).toBe('Gemini 3.1 Flash Lite Image')
    expect(displayName('Phoenix 1.0')).toBe('Phoenix 1.0')
  })
})
