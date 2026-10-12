import { z } from 'zod'
import { ModelId } from './models'
import type { JobKind } from './protocol'

/** Bytes that crossed a MessagePort (structured clone keeps Uint8Array). */
const Bytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array, { message: 'Expected bytes' })

const MAX_SIDE = 16384

const ImageFields = {
  width: z.number().int().min(1).max(MAX_SIDE),
  height: z.number().int().min(1).max(MAX_SIDE),
  pixels: Bytes
}
const pixelsMatch = (i: { width: number; height: number; pixels: Uint8Array }) =>
  i.pixels.length === i.width * i.height * 4

/** An RGBA image; `pixels.length` must equal width × height × 4. */
const Image = z
  .object(ImageFields)
  .refine(pixelsMatch, { message: 'pixels must be width × height × 4 bytes' })

const Provider = z.enum(['dml', 'cpu'])

/** A click on the object (label 1) or on what to exclude (label 0), in image pixels. */
const PromptPoint = z.object({ x: z.number(), y: z.number(), label: z.union([z.literal(0), z.literal(1)]) })

/** Mask of a region (255 = inside) cropped to its bounding box at (x, y) of the image. */
export const MaskCrop = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    data: Bytes
  })
  .refine((m) => m.data.length === m.width * m.height, { message: 'mask size mismatch' })
export type MaskCrop = z.infer<typeof MaskCrop>

export const RotatedRect = z.object({
  cx: z.number(),
  cy: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  angle: z.number()
})
export type RotatedRect = z.infer<typeof RotatedRect>

const Mask = z.object({ width: z.number().int(), height: z.number().int(), data: Bytes })

export const OcrLine = z.object({
  text: z.string(),
  confidence: z.number(),
  rect: RotatedRect,
  style: z.object({
    color: z.string(),
    background: z.string(),
    inkTop: z.number(),
    inkBottom: z.number(),
    strokeWidth: z.number()
  }),
  /** Ink pixels of the upright crop of `rect` (255 = text). */
  mask: Mask
})
export type OcrLine = z.infer<typeof OcrLine>

/** Input/output schemas per ML job; the worker validates inputs, the renderer validates results. */
export const jobs = {
  probe: {
    input: z.object({ model: ModelId }),
    result: z.object({
      model: ModelId,
      provider: Provider,
      loadMs: z.number(),
      sessions: z.array(
        z.object({ file: z.string(), inputs: z.array(z.string()), outputs: z.array(z.string()) })
      )
    })
  },
  ocr: {
    input: Image,
    result: z.object({ lines: z.array(OcrLine), provider: Provider })
  },
  inpaint: {
    input: z
      .object({
        width: z.number().int().min(1).max(MAX_SIDE),
        height: z.number().int().min(1).max(MAX_SIDE),
        pixels: Bytes,
        /** Explicit mask (255 = fill), or rectangles whose text pixels should be erased. */
        mask: Bytes.optional(),
        textRects: z.array(RotatedRect).optional(),
        /** 'auto' uses LaMa when installed, otherwise the fast fill. */
        quality: z.enum(['auto', 'fast'])
      })
      .refine((i) => i.pixels.length === i.width * i.height * 4, { message: 'pixels size mismatch' })
      .refine((i) => !i.mask || i.mask.length === i.width * i.height, { message: 'mask size mismatch' })
      .refine((i) => i.mask || i.textRects?.length, { message: 'mask or textRects required' }),
    result: z.object({ pixels: Bytes, method: z.enum(['lama', 'telea']) })
  },
  /** Encodes an image for object selection once; later `segment` calls refer to it by `key`. */
  'segment-prepare': {
    input: z
      .object({ key: z.string().min(1).max(200), ...ImageFields })
      .refine(pixelsMatch, { message: 'pixels size mismatch' }),
    result: z.object({ provider: Provider })
  },
  segment: {
    input: z
      .object({
        key: z.string().min(1).max(200),
        points: z.array(PromptPoint).max(64),
        box: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).optional()
      })
      .refine((i) => i.points.length > 0 || i.box, { message: 'points or box required' }),
    /** Null when nothing was selected. `score` is the model's own quality estimate (0..1). */
    result: z.object({ mask: MaskCrop.nullable(), score: z.number() })
  },
  'remove-bg': {
    input: Image,
    /** Opacity of the foreground per pixel (0..255), width × height bytes. */
    result: z.object({ alpha: Bytes, provider: Provider })
  }
} as const satisfies Record<JobKind, { input: z.ZodType; result: z.ZodType }>

export type JobInput<K extends JobKind> = z.infer<(typeof jobs)[K]['input']>
export type JobResult<K extends JobKind> = z.infer<(typeof jobs)[K]['result']>
