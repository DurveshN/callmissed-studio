import { z } from 'zod'
import { Color, Id } from '../document/model'

/**
 * What the renderer hands the PDF writer (main): every page with its geometry in PDF points, the
 * pictures to draw (assets read from the workspace, or `images` supplied with the plan), and layers
 * with everything that depends on on-screen layout (text line breaks, baselines) already resolved.
 * Positions are in page units (the editor's coordinates, top-left origin, y down); `unit` converts
 * them to points.
 */

const Bytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array, { message: 'Expected bytes' })
const Finite = z.number().finite()

const Box = {
  x: Finite,
  y: Finite,
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  rotation: Finite,
  opacity: z.number().min(0).max(1)
}

export const PdfImage = z.object({ type: z.literal('image'), ...Box, assetId: Id })

export const PdfShape = z.object({
  type: z.literal('shape'),
  ...Box,
  shape: z.enum(['rect', 'ellipse', 'line']),
  fill: Color.nullable(),
  stroke: Color.nullable(),
  strokeWidth: z.number().min(0)
})

export const PdfText = z.object({
  type: z.literal('text'),
  ...Box,
  family: z.string().min(1).max(200),
  weight: z.number().int().min(100).max(900),
  italic: z.boolean(),
  color: Color,
  fontSize: z.number().positive(),
  align: z.enum(['left', 'center', 'right']),
  /** Distance between baselines. */
  lineAdvance: z.number().positive(),
  /** First baseline, measured from the layer's top. */
  baseline: Finite,
  /** Lines as laid out on screen, each with its on-screen width. */
  lines: z.array(z.object({ text: z.string().max(100_000), width: z.number().nonnegative() })).max(10_000)
})

export const PdfLayer = z.discriminatedUnion('type', [PdfImage, PdfShape, PdfText])

/** Recognized text of a scanned page, drawn invisibly so the PDF is searchable. */
export const PdfOcrLine = z.object({
  text: z.string().min(1).max(10_000),
  /** Rotated box of the line in page units (centre, size, angle in degrees). */
  cx: Finite,
  cy: Finite,
  width: z.number().positive(),
  height: z.number().positive(),
  angle: Finite
})

export const PdfPage = z.object({
  /** Page size in page units, and points per page unit. */
  width: z.number().positive(),
  height: z.number().positive(),
  unit: z.number().positive(),
  /**
   * 'copy': start from page `index` of the source PDF (vectors and text kept); `toPdf` maps the
   * page's view space (points, origin bottom-left, y up, as displayed) to that page's PDF user space.
   * 'new': a blank page of the given size.
   */
  base: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('copy'),
      index: z.number().int().nonnegative(),
      toPdf: z.tuple([Finite, Finite, Finite, Finite, Finite, Finite])
    }),
    z.object({ kind: z.literal('new') })
  ]),
  /** Picture drawn over the whole page first (image-backed pages). */
  background: Id.nullable(),
  patches: z.array(z.object({ assetId: Id, x: Finite, y: Finite, width: Finite, height: Finite })),
  /** Bottom-most first; hidden layers are left out. */
  layers: z.array(PdfLayer),
  ocr: z.array(PdfOcrLine)
})

export const PdfPlan = z.object({
  pages: z.array(PdfPage).min(1),
  /** PNG or JPEG pictures supplied by the renderer (adjusted or converted), by id; others are workspace assets. */
  images: z.record(Id, Bytes),
  title: z.string().max(260)
})

export type PdfPlan = z.infer<typeof PdfPlan>
export type PdfPage = z.infer<typeof PdfPage>
export type PdfLayer = z.infer<typeof PdfLayer>
export type PdfText = z.infer<typeof PdfText>
export type PdfOcrLine = z.infer<typeof PdfOcrLine>
