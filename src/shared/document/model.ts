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
  origin: z.enum(['cutout', 'import', 'ai'])
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
  z.object({ kind: z.literal('pdf'), pageIndex: z.number().int().nonnegative() })
])

export const Page = z.object({
  id: Id,
  width: z.number().positive(),
  height: z.number().positive(),
  background: PageBackground,
  patches: z.array(Patch),
  /** Bottom-most first. */
  layers: z.array(Layer)
})

export const AssetMeta = z.object({
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'application/pdf'])
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
  createdAt: z.iso.datetime()
})

export type Color = z.infer<typeof Color>
export type TextLayer = z.infer<typeof TextLayer>
export type ImageLayer = z.infer<typeof ImageLayer>
export type ShapeLayer = z.infer<typeof ShapeLayer>
export type Layer = z.infer<typeof Layer>
export type Patch = z.infer<typeof Patch>
export type Page = z.infer<typeof Page>
export type PageBackground = z.infer<typeof PageBackground>
export type AssetMime = z.infer<typeof AssetMeta>['mime']
export type StudioDocument = z.infer<typeof StudioDocument>
