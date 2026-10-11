import { z } from 'zod'
import { ModelId } from './models'
import type { JobKind } from './protocol'

/** Bytes that crossed a MessagePort (structured clone keeps Uint8Array). */
const Bytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array, { message: 'Expected bytes' })

const MAX_SIDE = 16384

/** An RGBA image; `pixels.length` must equal width × height × 4. */
const Image = z
  .object({
    width: z.number().int().min(1).max(MAX_SIDE),
    height: z.number().int().min(1).max(MAX_SIDE),
    pixels: Bytes
  })
  .refine((i) => i.pixels.length === i.width * i.height * 4, {
    message: 'pixels must be width × height × 4 bytes'
  })

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
      provider: z.enum(['dml', 'cpu']),
      loadMs: z.number(),
      sessions: z.array(
        z.object({ file: z.string(), inputs: z.array(z.string()), outputs: z.array(z.string()) })
      )
    })
  },
  ocr: {
    input: Image,
    result: z.object({ lines: z.array(OcrLine), provider: z.enum(['dml', 'cpu']) })
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
  }
} as const satisfies Record<JobKind, { input: z.ZodType; result: z.ZodType }>

export type JobInput<K extends JobKind> = z.infer<(typeof jobs)[K]['input']>
export type JobResult<K extends JobKind> = z.infer<(typeof jobs)[K]['result']>
