import { z } from 'zod'

/** Hex color, #rrggbb or #rrggbbaa. */
export const Color = z.string().regex(/^#([0-9a-f]{6}|[0-9a-f]{8})$/i)
export const Id = z.uuid()

/** Pixels per PDF point used for the editing raster of PDF pages. */
export const PDF_RENDER_SCALE = 2

const Box = {
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  rotation: z.number()
}

/** Non-destructive color adjustments, each −1..1 (0 = unchanged). */
export const Adjustments = z.object({
  brightness: z.number().min(-1).max(1),
  contrast: z.number().min(-1).max(1),
  saturation: z.number().min(-1).max(1)
})

const LayerBase = {
  id: Id,
  name: z.string().max(200),
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: z.number().min(0).max(1),
  ...Box
}

export const TextLayer = z.object({
  ...LayerBase,
  type: z.literal('text'),
  text: z.string().max(100_000),
  fontFamily: z.string().min(1).max(200),
  fontSize: z.number().positive().max(2000),
  fontWeight: z.number().int().min(100).max(900),
  italic: z.boolean(),
  color: Color,
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().positive().max(10),
  origin: z.enum(['ocr', 'pdf-native', 'user'])
})

export const ImageLayer = z.object({
  ...LayerBase,
  type: z.literal('image'),
  assetId: Id,
  origin: z.enum(['cutout', 'import', 'ai']),
  adjustments: Adjustments.optional()
})

export const ShapeLayer = z.object({
  ...LayerBase,
  type: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse', 'line']),
  fill: Color.nullable(),
  stroke: Color.nullable(),
  strokeWidth: z.number().min(0).max(500)
})

export const Layer = z.discriminatedUnion('type', [TextLayer, ImageLayer, ShapeLayer])

/** Pixels painted over the original background (e.g. inpainted areas). */
export const Patch = z.object({
  id: Id,
  assetId: Id,
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive()
})

export const PageBackground = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), assetId: Id }),
  z.object({
    kind: z.literal('pdf'),
    pageIndex: z.number().int().nonnegative(),
    /** The PDF asset the page comes from; absent means the document's own PDF (`source.assetId`). */
    assetId: Id.optional()
  })
])

export const Page = z.object({
  id: Id,
  width: z.number().positive(),
  height: z.number().positive(),
  background: PageBackground,
  patches: z.array(Patch),
  /** Applied to the page picture (background and patches), not to layers. */
  adjustments: Adjustments.optional(),
  /** Bottom-most first. */
  layers: z.array(Layer)
})

export const AssetMeta = z.object({
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'application/pdf'])
})

/** An AI result kept with the project (its image is a document asset). Not part of undo. */
export const Generation = z.object({
  id: Id,
  assetId: Id,
  prompt: z.string().max(4000),
  model: z.string().max(100),
  size: z.string().max(20),
  revisedPrompt: z.string().max(10_000).nullable(),
  credits: z.number().nonnegative(),
  /** The page it was generated from. */
  pageId: Id,
  createdAt: z.iso.datetime(),
  /** Generated here, or imported from the CallMissed account history. */
  source: z.enum(['generated', 'imported'])
})

export const StudioDocument = z.object({
  id: Id,
  name: z.string().min(1).max(260),
  source: z.object({
    kind: z.enum(['image', 'pdf']),
    fileName: z.string().max(260),
    assetId: Id
  }),
  assets: z.record(Id, AssetMeta),
  pages: z.array(Page).min(1),
  /** Newest last. Optional: projects from before AI generation have none. */
  generations: z.array(Generation).optional(),
  createdAt: z.iso.datetime()
})

export type Color = z.infer<typeof Color>
export type Adjustments = z.infer<typeof Adjustments>
export type TextLayer = z.infer<typeof TextLayer>
export type ImageLayer = z.infer<typeof ImageLayer>
export type ShapeLayer = z.infer<typeof ShapeLayer>
export type Layer = z.infer<typeof Layer>
export type Patch = z.infer<typeof Patch>
export type Page = z.infer<typeof Page>
export type Generation = z.infer<typeof Generation>
export type PageBackground = z.infer<typeof PageBackground>
export type AssetMime = z.infer<typeof AssetMeta>['mime']
export type StudioDocument = z.infer<typeof StudioDocument>

/**
 * Points per page unit: PDF pages are edited at PDF_RENDER_SCALE pixels per point, pictures at 96 dpi
 * (pictures in a PDF document keep the PDF scale, as they were made from its pages).
 */
export function pointsPerUnit(doc: StudioDocument, page: Page): number {
  return page.background.kind === 'pdf' || doc.source.kind === 'pdf' ? 1 / PDF_RENDER_SCALE : 0.75
}

/** The PDF asset a PDF-backed page is drawn from (pages can come from several PDFs). */
export function pdfAssetOf(doc: StudioDocument, bg: Extract<PageBackground, { kind: 'pdf' }>): string {
  return bg.assetId ?? doc.source.assetId
}
