import type { Adjustments, Layer, Page, StudioDocument } from '@shared/document/model'
import { pdfAssetOf, pointsPerUnit } from '@shared/document/model'
import type { PdfLayer, PdfOcrLine, PdfPage, PdfPlan } from '@shared/pdf/plan'
import { viewToPdf } from '@shared/pdf/view-matrix'
import { adjustPixels } from '../adjust/adjust'
import { loadAssetImage } from '../assets/asset-cache'
import { pdfPageInfo } from '../assets/pdf'
import { textLayout } from '../canvas/text-metrics'
import { MlError, runJob } from '../ml/ml-client'
import { encodePng, snapshot } from '../raster/raster-target'

export interface PlanOptions {
  /** Add invisible recognized text to pages that show no real text (scans, photos). */
  searchable: boolean
  /**
   * Pages whose original PDF content was painted over (edited text, removed objects) are written as
   * pictures, so the replaced text is really gone; otherwise it stays in the copied page, hidden
   * under the patch but still selectable and searchable.
   */
  flattenEdited: boolean
  /** 0-based indexes of the pages to write, in order (all pages when absent). */
  pages?: number[]
  signal?: AbortSignal
  progress?(done: number, total: number): void
}

class Images {
  /** Pictures the writer can't read from the workspace as they are (adjusted or not PNG/JPEG). */
  readonly extra: Record<string, Uint8Array> = {}

  constructor(private readonly doc: StudioDocument) {}

  /** The asset to draw for `assetId` with `adjustments` applied. */
  async picture(assetId: string, adjustments: Adjustments | undefined): Promise<string> {
    const mime = this.doc.assets[assetId]?.mime
    if (!adjustments && (mime === 'image/png' || mime === 'image/jpeg')) return assetId
    const image = await loadAssetImage(this.doc.id, assetId)
    const ctx = new OffscreenCanvas(image.naturalWidth, image.naturalHeight).getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is unavailable')
    ctx.drawImage(image, 0, 0)
    const pixels = ctx.getImageData(0, 0, image.naturalWidth, image.naturalHeight)
    if (adjustments) adjustPixels(pixels.data, adjustments)
    return this.add(await encodePng(pixels.data, pixels.width, pixels.height))
  }

  add(bytes: Uint8Array): string {
    const id = crypto.randomUUID()
    this.extra[id] = bytes
    return id
  }
}

async function layerPlan(layer: Layer, images: Images): Promise<PdfLayer> {
  const box = {
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    rotation: layer.rotation,
    opacity: layer.opacity
  }
  if (layer.type === 'image') {
    return { type: 'image', ...box, assetId: await images.picture(layer.assetId, layer.adjustments) }
  }
  if (layer.type === 'shape') {
    return {
      type: 'shape',
      ...box,
      shape: layer.shape,
      fill: layer.fill,
      stroke: layer.stroke,
      strokeWidth: layer.strokeWidth
    }
  }
  return {
    type: 'text',
    ...box,
    family: layer.fontFamily,
    weight: layer.fontWeight,
    italic: layer.italic,
    color: layer.color,
    fontSize: layer.fontSize,
    align: layer.align,
    ...textLayout(layer)
  }
}

/** Recognized lines of the page picture, for invisible searchable text. */
async function recognize(doc: StudioDocument, page: Page, signal?: AbortSignal): Promise<PdfOcrLine[]> {
  const snap = await snapshot(doc, { kind: 'page', pageId: page.id })
  const { width, height, data } = snap.image
  const result = await runJob(
    'ocr',
    { width, height, pixels: new Uint8Array(data.buffer.slice(0)) },
    signal ? { signal } : {}
  )
  return result.lines.map((line) => ({ text: line.text, ...line.rect }))
}

async function pagePlan(
  doc: StudioDocument,
  page: Page,
  images: Images,
  options: PlanOptions
): Promise<PdfPage> {
  const unit = pointsPerUnit(doc, page)
  const bg = page.background
  const layers = await Promise.all(page.layers.filter((l) => l.visible).map((l) => layerPlan(l, images)))
  let base: PdfPage['base'] = { kind: 'new' }
  let background: string | null = null
  let patches = page.patches.map(({ assetId, x, y, width, height }) => ({ assetId, x, y, width, height }))
  let hasText = false

  const flatten = bg.kind === 'pdf' && options.flattenEdited && page.patches.length > 0
  if (bg.kind === 'pdf' && !page.adjustments && !flatten) {
    // The original page is copied as it is (vectors and text kept); edits are drawn over it.
    const assetId = pdfAssetOf(doc, bg)
    const info = await pdfPageInfo(doc.id, assetId, bg.pageIndex)
    base = { kind: 'copy', assetId, index: bg.pageIndex, toPdf: viewToPdf(info.transform, info.height) }
    hasText = info.hasText
  } else if (bg.kind === 'image' && !page.adjustments) {
    background = await images.picture(bg.assetId, undefined)
  } else {
    // Adjusted page picture, or an edited PDF page being flattened: drawn as one image.
    const snap = await snapshot(doc, { kind: 'page', pageId: page.id })
    if (page.adjustments) adjustPixels(snap.image.data, page.adjustments)
    background = images.add(await encodePng(snap.image.data, snap.image.width, snap.image.height))
    patches = []
  }
  const ocr = options.searchable && !hasText ? await recognize(doc, page, options.signal) : []
  return { width: page.width, height: page.height, unit, base, background, patches, layers, ocr }
}

/** Everything the PDF writer needs for `doc`, page by page. */
export async function buildPdfPlan(doc: StudioDocument, options: PlanOptions): Promise<PdfPlan> {
  const images = new Images(doc)
  const chosen = options.pages ? options.pages.flatMap((i) => doc.pages[i] ?? []) : doc.pages
  if (chosen.length === 0) throw new Error('No pages to export')
  const pages: PdfPage[] = []
  for (const [i, page] of chosen.entries()) {
    if (options.signal?.aborted) throw new MlError('CANCELLED', 'Cancelled')
    pages.push(await pagePlan(doc, page, images, options))
    options.progress?.(i + 1, chosen.length)
  }
  return { title: doc.name, pages, images: images.extra }
}
