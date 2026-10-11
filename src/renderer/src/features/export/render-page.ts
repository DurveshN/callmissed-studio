import { selectActivePage, useDocumentStore } from '../document/store'
import { getPageGroup } from '../canvas/stage-registry'

export type ExportFormat = 'png' | 'jpeg' | 'webp'

const MIME: Record<ExportFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
const THUMBNAIL_SIZE = 320

/** Renders the active page at `scale` × its pixel size (page area only, no selection UI). */
export function renderActivePage(scale: number): HTMLCanvasElement {
  const page = selectActivePage(useDocumentStore.getState())
  const group = getPageGroup()
  if (!page || !group) throw new Error('No page to render')

  // The group sits at page origin (0,0) in stage space; convert the page rect to client pixels.
  const stage = group.getStage()
  if (!stage) throw new Error('Canvas is not mounted')
  const stageScale = stage.scaleX()
  return group.toCanvas({
    x: stage.x(),
    y: stage.y(),
    width: page.width * stageScale,
    height: page.height * stageScale,
    pixelRatio: scale / stageScale
  })
}

function toBlob(canvas: HTMLCanvasElement, format: ExportFormat, quality: number): Promise<Blob> {
  let source = canvas
  if (format === 'jpeg') {
    // JPEG has no alpha: flatten onto white instead of black.
    source = document.createElement('canvas')
    source.width = canvas.width
    source.height = canvas.height
    const ctx = source.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, source.width, source.height)
    ctx.drawImage(canvas, 0, 0)
  }
  return new Promise((resolve, reject) =>
    source.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), MIME[format], quality)
  )
}

export async function encodeActivePage(
  format: ExportFormat,
  scale: number,
  quality: number
): Promise<Uint8Array> {
  const blob = await toBlob(renderActivePage(scale), format, quality)
  return new Uint8Array(await blob.arrayBuffer())
}

/** Small PNG of the active page for the recent-projects list. */
export async function renderThumbnail(): Promise<Uint8Array> {
  const page = selectActivePage(useDocumentStore.getState())
  if (!page) throw new Error('No page')
  const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(page.width, page.height))
  return encodeActivePage('png', scale, 1)
}
