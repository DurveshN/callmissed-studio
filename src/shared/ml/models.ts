import { z } from 'zod'

export const MODEL_IDS = ['ocr', 'segment', 'inpaint', 'remove-bg'] as const
export const ModelId = z.enum(MODEL_IDS)
export type ModelId = z.infer<typeof ModelId>

export const ModelFile = z.object({
  /** File name inside models/<id>/ (ONNX external-data files must keep their original names). */
  name: z.string().regex(/^[\w.-]+$/),
  /** Tried in order; the first is the primary source, the rest are mirrors. */
  urls: z.array(z.url({ protocol: /^https?$/ })).min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive()
})

export const ModelPack = z.object({
  id: ModelId,
  name: z.string(),
  description: z.string(),
  group: z.enum(['essential', 'optional']),
  license: z.string(),
  /** Upstream page, for attribution. */
  source: z.url(),
  /** Bumped when files change, so installed packs are re-downloaded. */
  version: z.string(),
  /** false: always run on CPU (the model fails or gains nothing on DirectML). Default true. */
  gpu: z.boolean().optional(),
  files: z.array(ModelFile).min(1)
})

export const ModelManifest = z.object({
  schema: z.literal(1),
  packs: z.array(ModelPack).min(1)
})

export type ModelFile = z.infer<typeof ModelFile>
export type ModelPack = z.infer<typeof ModelPack>
export type ModelManifest = z.infer<typeof ModelManifest>

export const ModelState = z.enum(['missing', 'queued', 'downloading', 'verifying', 'installed', 'error'])

export const ModelStatus = z.object({
  id: ModelId,
  name: z.string(),
  description: z.string(),
  group: ModelPack.shape.group,
  license: z.string(),
  totalBytes: z.number(),
  state: ModelState,
  receivedBytes: z.number(),
  error: z.string().nullable()
})
export type ModelStatus = z.infer<typeof ModelStatus>

export const packBytes = (pack: ModelPack): number => pack.files.reduce((sum, f) => sum + f.bytes, 0)
