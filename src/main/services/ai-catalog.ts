import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  CREDITS_PER_USD,
  PLAN_TIERS,
  referenceLimit,
  type AiModel,
  type AiModelList,
  type PlanTier
} from '@shared/ai/models'
import type { CallMissedClient } from './callmissed-client'
import { writeFileAtomic } from './fs-utils'

/** What is cached on disk: the list and which key it was built for (a fingerprint, never the key). */
interface Cache extends AiModelList {
  key: string | null
}

/** The catalogue's names are often slugs ("gpt-image-2"): shown as "GPT Image 2". Real names are kept. */
export function displayName(name: string): string {
  if (!/^[a-z0-9.-]+$/.test(name)) return name
  const acronyms = new Set(['gpt', 'sdxl', 'lcm', 'ai'])
  return name
    .split('-')
    .map((part) => (acronyms.has(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}

const fingerprint = (key: string | null) =>
  key ? createHash('sha256').update(key).digest('hex').slice(0, 16) : null

/**
 * The image-to-image models for the current key, built from CallMissed's API (catalogue: names,
 * prices, maintenance; plan access: lowest plan; the key's own list: what it may call) and kept in
 * userData until the key changes or the user refreshes.
 */
export class AiCatalog {
  private cache: Cache | null = null
  private loaded = false

  constructor(
    private readonly file: string,
    private readonly client: CallMissedClient,
    private readonly getKey: () => Promise<string | null>
  ) {}

  private async read(): Promise<Cache | null> {
    if (!this.loaded) {
      this.loaded = true
      try {
        this.cache = JSON.parse(await readFile(this.file, 'utf8')) as Cache
      } catch {
        this.cache = null
      }
    }
    return this.cache
  }

  /** The cached list when it was built for the current key; otherwise (or with `refresh`) a fresh one. */
  async list(refresh = false): Promise<AiModelList> {
    const key = await this.getKey()
    const cached = await this.read()
    if (!refresh && cached && cached.key === fingerprint(key) && cached.models.length > 0) {
      return { models: cached.models, fetchedAt: cached.fetchedAt, keyChecked: cached.keyChecked }
    }
    const fresh = await this.build(key)
    this.cache = { ...fresh, key: fingerprint(key) }
    await writeFileAtomic(this.file, JSON.stringify(this.cache, null, 2))
    return fresh
  }

  /** The model as last listed (for pricing and limits when generating). */
  async find(id: string): Promise<AiModel | null> {
    return (await this.list()).models.find((m) => m.id === id) ?? null
  }

  private async build(key: string | null): Promise<AiModelList> {
    const [catalogue, access, own] = await Promise.all([
      this.client.catalogue(),
      this.client.planAccess().catch(() => null),
      key ? this.client.keyModels().catch(() => null) : Promise.resolve(null)
    ])
    const minPlan = (id: string): PlanTier | null =>
      access ? (PLAN_TIERS.find((tier) => access[tier]?.includes(id)) ?? null) : null
    const models = catalogue.flatMap((entry): AiModel[] => {
      const limit = referenceLimit(entry.id)
      if (!limit) return [] // image-to-image only
      const onKey = own === null || own.has(entry.id)
      const down = entry.status === 'maintenance'
      return [
        {
          id: entry.id,
          name: displayName(entry.name),
          description: entry.description,
          provider: entry.ownedBy,
          priceUsd: entry.priceUsd,
          credits: Math.round(entry.priceUsd * CREDITS_PER_USD * 100) / 100,
          free: entry.free,
          minPlan: minPlan(entry.id),
          available: onKey && !down,
          note: down
            ? (entry.statusMessage ?? 'Under maintenance')
            : onKey
              ? null
              : 'Not available for this API key',
          referenceMaxBytes: limit.maxBytes
        }
      ]
    })
    // Cheapest plan first, then price: what most keys can use comes first.
    const rank = (m: AiModel) => (m.minPlan ? PLAN_TIERS.indexOf(m.minPlan) : PLAN_TIERS.length)
    models.sort(
      (a, b) => Number(b.available) - Number(a.available) || rank(a) - rank(b) || a.credits - b.credits
    )
    return { models, fetchedAt: new Date().toISOString(), keyChecked: own !== null }
  }
}
