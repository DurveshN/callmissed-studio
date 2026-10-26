import { pdfAssetOf, type ImageLayer, type Page, type StudioDocument } from '@shared/document/model'
import { loadAssetImage } from '../assets/asset-cache'
import { renderPdfPage } from '../assets/pdf'

/**
 * Pixels the image tools operate on: the page's background (original upload, PDF page, or an
 * AI result used as the page) including earlier patches, or an image layer (inserted or AI-generated).
 */
export type RasterTarget =
  { kind: 'page'; pageId: string } | { kind: 'layer'; pageId: string; layerId: string }

export interface Point {
  x: number
  y: number
}

export interface RasterSnapshot {
  target: RasterTarget
  image: ImageData
  /** Maps a pixel position of `image` to page coordinates. */
  toPage(p: Point): Point
  /** Maps page coordinates to a pixel position of `image` (inverse of toPage). */
  fromPage(p: Point): Point
  /** Page units per image pixel (uniform for pages; per-axis average for layers). */
  scale: number
  /** Extra rotation (degrees) applied to the raster on the page. */
  rotation: number
}

function canvas(width: number, height: number): OffscreenCanvasRenderingContext2D {
  const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D is unavailable')
  return ctx
}

async function pageBackground(doc: StudioDocument, page: Page): Promise<CanvasImageSource> {
  const bg = page.background
  if (bg.kind === 'image') return loadAssetImage(doc.id, bg.assetId)
  return renderPdfPage(doc.id, pdfAssetOf(doc, bg), bg.pageIndex)
}

/** Composites the page background and its patches at page resolution. */
async function snapshotPage(doc: StudioDocument, page: Page): Promise<RasterSnapshot> {
  const width = Math.round(page.width)
  const height = Math.round(page.height)
  const ctx = canvas(width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(await pageBackground(doc, page), 0, 0, width, height)
  for (const patch of page.patches) {
    ctx.drawImage(await loadAssetImage(doc.id, patch.assetId), patch.x, patch.y, patch.width, patch.height)
  }
  return {
    target: { kind: 'page', pageId: page.id },
    image: ctx.getImageData(0, 0, width, height),
    toPage: (p) => p,
    fromPage: (p) => p,
    scale: 1,
    rotation: 0
  }
}

/** The layer's image at its native resolution, with a mapping that applies the layer's transform. */
async function snapshotLayer(doc: StudioDocument, page: Page, layer: ImageLayer): Promise<RasterSnapshot> {
  const img = await loadAssetImage(doc.id, layer.assetId)
  const ctx = canvas(img.naturalWidth, img.naturalHeight)
  ctx.drawImage(img, 0, 0)
  const sx = layer.width / img.naturalWidth
  const sy = layer.height / img.naturalHeight
  const rad = (layer.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    target: { kind: 'layer', pageId: page.id, layerId: layer.id },
    image: ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight),
    toPage: ({ x, y }) => ({
      x: layer.x + x * sx * cos - y * sy * sin,
      y: layer.y + x * sx * sin + y * sy * cos
    }),
    fromPage: ({ x, y }) => {
      const dx = x - layer.x
      const dy = y - layer.y
      return { x: (dx * cos + dy * sin) / sx, y: (-dx * sin + dy * cos) / sy }
    },
    scale: (sx + sy) / 2,
    rotation: layer.rotation
  }
}

export async function snapshot(doc: StudioDocument, target: RasterTarget): Promise<RasterSnapshot> {
  const page = doc.pages.find((p) => p.id === target.pageId)
  if (!page) throw new Error('Page not found')
  if (target.kind === 'page') return snapshotPage(doc, page)
  const layer = page.layers.find((l) => l.id === target.layerId)
  if (layer?.type !== 'image') throw new Error('Select an image layer')
  return snapshotLayer(doc, page, layer)
}

/** The image layer the user has selected, or the page itself. */
export function currentTarget(page: Page, selection: string[]): RasterTarget {
  const selected = page.layers.filter((l) => selection.includes(l.id))
  const only = selected.length === 1 ? selected[0] : undefined
  return only?.type === 'image'
    ? { kind: 'layer', pageId: page.id, layerId: only.id }
    : { kind: 'page', pageId: page.id }
}

/** The topmost visible, unlocked image layer under page point `p`, or the page itself. */
export function targetAt(page: Page, p: Point): RasterTarget {
  for (let i = page.layers.length - 1; i >= 0; i--) {
    const layer = page.layers[i]
    if (layer?.type !== 'image' || !layer.visible || layer.locked) continue
    const rad = (layer.rotation * Math.PI) / 180
    const dx = p.x - layer.x
    const dy = p.y - layer.y
    const u = dx * Math.cos(rad) + dy * Math.sin(rad)
    const v = -dx * Math.sin(rad) + dy * Math.cos(rad)
    if (u >= 0 && v >= 0 && u <= layer.width && v <= layer.height) {
      return { kind: 'layer', pageId: page.id, layerId: layer.id }
    }
  }
  return { kind: 'page', pageId: page.id }
}

export const sameTarget = (a: RasterTarget | null, b: RasterTarget | null): boolean =>
  !!a &&
  !!b &&
  a.kind === b.kind &&
  a.pageId === b.pageId &&
  (a.kind === 'page' || (b.kind === 'layer' && a.layerId === b.layerId))

/** Encodes RGBA pixels as PNG bytes. */
export async function encodePng(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): Promise<Uint8Array> {
  const ctx = canvas(width, height)
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
  const blob = await ctx.canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/** Copies a rectangle of an ImageData into a tightly packed RGBA buffer. */
export function cropPixels(
  image: { width: number; data: Uint8ClampedArray | Uint8Array },
  x: number,
  y: number,
  width: number,
  height: number
): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * image.width + x) * 4
    out.set(image.data.subarray(from, from + width * 4), row * width * 4)
  }
  return out
}
