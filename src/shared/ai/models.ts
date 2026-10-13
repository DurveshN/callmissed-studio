/**
 * CallMissed image models usable for image-to-image (they accept `reference_images`), with their
 * per-image credit cost (docs.callmissed.com/docs/image-generation, verified 2026-10-13).
 */
export const AI_MODELS = [
  {
    id: 'gpt-image-2.5-sunburst',
    name: 'GPT Image 2.5 Sunburst',
    credits: 25,
    note: 'Most capable, precise edits'
  },
  { id: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare', credits: 25, note: 'Reference-image editing' },
  { id: 'gpt-image-2', name: 'GPT Image 2', credits: 25, note: 'Best with text in images' },
  { id: 'gpt-image-1.5', name: 'GPT Image 1.5', credits: 25, note: 'Keeps logos and faces' }
] as const

export type AiModelId = (typeof AI_MODELS)[number]['id']
export const AI_MODEL_IDS = AI_MODELS.map((m) => m.id) as [AiModelId, ...AiModelId[]]
export const DEFAULT_AI_MODEL: AiModelId = 'gpt-image-2'

/** Credits a generation of `n` images with `model` costs (1 credit = ₹1). */
export function creditsFor(model: string, n: number): number {
  return (AI_MODELS.find((m) => m.id === model)?.credits ?? 0) * n
}

/** Output sizes the GPT image models produce; the one closest to the page's shape is used. */
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
