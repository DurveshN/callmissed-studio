/**
 * Image models come from CallMissed at run time (catalogue, plan access, the key's own list); see
 * main/services/ai-catalog.ts. Only what the API does not expose lives here, each with its source.
 */

/** 1 credit = ₹1 and US$1 = ₹96 (docs.callmissed.com/docs/pricing): catalogue USD prices → credits. */
export const CREDITS_PER_USD = 96

/**
 * Which models can edit a picture (`reference_images`) and their limits. The API has no capability
 * field for this; docs.callmissed.com/docs/image-generation (2026-10-13): "reference_images work only
 * with gpt-image-2.5-sunburst, gpt-image-2.5-flare, gpt-image-2, gpt-image-1.5, nano-banana-2,
 * nano-banana-pro and gemini-3.1-flash-lite-image"; the three Google models take references of at
 * most 7 MB each, the others 10 MB.
 */
export function referenceLimit(modelId: string): { maxBytes: number } | null {
  if (/^gpt-image-/.test(modelId)) return { maxBytes: 10 * 1024 * 1024 }
  if (['nano-banana-2', 'nano-banana-pro', 'gemini-3.1-flash-lite-image'].includes(modelId)) {
    return { maxBytes: 7 * 1024 * 1024 }
  }
  return null
}

/** Preferred default when available (best with text on images). */
export const PREFERRED_AI_MODEL = 'gpt-image-2'

/** Output sizes for image-to-image; the one closest to the page's shape is used. */
export const AI_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const
export type AiSize = (typeof AI_SIZES)[number]

export function sizeFor(width: number, height: number): AiSize {
  const ratio = width / height
  return ratio >= 1.2 ? '1536x1024' : ratio <= 1 / 1.2 ? '1024x1536' : '1024x1024'
}

/** Prompt length the API accepts. */
export const MAX_PROMPT = 4000
/** Most images one request may ask for. */
export const MAX_IMAGES = 4

/** Plan tiers in order (docs.callmissed.com/docs/models: Free, Starter, Pro, Enterprise). */
export const PLAN_TIERS = ['free', 'starter', 'pro', 'enterprise'] as const
export type PlanTier = (typeof PLAN_TIERS)[number]

/** An image-to-image model as offered in the app (built from CallMissed's API). */
export interface AiModel {
  id: string
  name: string
  description: string
  provider: string
  priceUsd: number
  /** Per generated image. */
  credits: number
  free: boolean
  /** Lowest plan whose access list includes the model (null when the access list didn't say). */
  minPlan: PlanTier | null
  /** Listed for this key and not under maintenance. */
  available: boolean
  /** Why it isn't available (maintenance message, or not on the key), else null. */
  note: string | null
  referenceMaxBytes: number
}

/** The cached model list for one key. */
export interface AiModelList {
  models: AiModel[]
  fetchedAt: string
  /** Built without the key's own list (no key yet, or it could not be read). */
  keyChecked: boolean
}
