import { useEffect, useState } from 'react'
import { getDocument, GlobalWorkerOptions, OPS, Util, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDF_RENDER_SCALE } from '@shared/document/model'
import { call } from '../../lib/ipc'

GlobalWorkerOptions.workerSrc = workerUrl

const base = new URL('pdfjs/', document.baseURI).toString()

let loaded: { assetId: string; pdf: Promise<PDFDocumentProxy> } | null = null
const pages = new Map<string, Promise<HTMLCanvasElement>>()

export function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({
    // pdf.js transfers the buffer to its worker, so give it a copy.
    data: bytes.slice(),
    // Keeps each font's real name ("ABCDEF+Calibri-Bold"), which Detect Text uses for PDF text.
    fontExtraProperties: true,
    cMapUrl: `${base}cmaps/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`
  }).promise
}

/** Page sizes in PDF points. */
export async function pdfPageSizes(pdf: PDFDocumentProxy): Promise<{ width: number; height: number }[]> {
  const sizes = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const viewport = (await pdf.getPage(i)).getViewport({ scale: 1 })
    sizes.push({ width: viewport.width, height: viewport.height })
  }
  return sizes
}

function sourcePdf(docId: string, assetId: string): Promise<PDFDocumentProxy> {
  if (loaded?.assetId !== assetId) {
    const pdf = call('asset:read', { docId, assetId }).then(openPdf)
    loaded = { assetId, pdf }
  }
  return loaded.pdf
}

/** Renders a page at `pixelsPerPoint` into a canvas (cached). */
export function renderPdfPage(
  docId: string,
  assetId: string,
  pageIndex: number,
  pixelsPerPoint = PDF_RENDER_SCALE
): Promise<HTMLCanvasElement> {
  const key = `${assetId}:${pageIndex}:${pixelsPerPoint}`
  let pending = pages.get(key)
  if (!pending) {
    pending = (async () => {
      const page = await (await sourcePdf(docId, assetId)).getPage(pageIndex + 1)
      const viewport = page.getViewport({ scale: pixelsPerPoint })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvas, viewport, background: '#ffffff' }).promise
      return canvas
    })()
    pending.catch(() => pages.delete(key))
    pages.set(key, pending)
  }
  return pending
}

export function clearPdfCache(): void {
  void loaded?.pdf.then((pdf) => pdf.loadingTask.destroy()).catch(() => undefined)
  loaded = null
  pages.clear()
}

export function usePdfPage(
  docId: string | null,
  assetId: string | null,
  pageIndex: number | null,
  pixelsPerPoint = PDF_RENDER_SCALE
): HTMLCanvasElement | null {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (!docId || !assetId || pageIndex === null) return
    let alive = true
    renderPdfPage(docId, assetId, pageIndex, pixelsPerPoint)
      .then((c) => alive && setCanvas(c))
      .catch((error: unknown) => console.error('Failed to render PDF page', pageIndex, error))
    return () => {
      alive = false
    }
  }, [docId, assetId, pageIndex, pixelsPerPoint])
  return pageIndex === null ? null : canvas
}

/**
 * Geometry of a source page as displayed (points; pdf.js's viewport transform at scale 1, which
 * includes /Rotate and the crop box), and whether it holds real text (scanned pages don't).
 */
export async function pdfPageInfo(
  docId: string,
  assetId: string,
  pageIndex: number
): Promise<{ transform: number[]; width: number; height: number; hasText: boolean }> {
  const page = await (await sourcePdf(docId, assetId)).getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const hasText = content.items.some((item) => 'str' in item && item.str.trim() !== '')
  return { transform: [...viewport.transform], width: viewport.width, height: viewport.height, hasText }
}

/** A run of a page's text in page units (`pixelsPerPoint` per point, y down), with its font. */
export interface PdfTextRun {
  text: string
  x: number
  y: number
  angle: number
  size: number
  width: number
  font: string
  ascent: number
  descent: number
}

/** Operators that draw pictures (photos, screenshots, scans), whose text only recognition can read. */
const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageXObjectRepeat,
  OPS.paintImageMaskXObject,
  OPS.paintImageMaskXObjectGroup,
  OPS.paintImageMaskXObjectRepeat
])

/**
 * The page's text runs and, per font, its PDF name and kind (fonts are resolved by loading the page),
 * and whether the page draws pictures.
 */
export async function pdfTextRuns(
  docId: string,
  assetId: string,
  pageIndex: number,
  pixelsPerPoint = PDF_RENDER_SCALE
): Promise<{
  runs: PdfTextRun[]
  fonts: Map<string, { name: string; serif: boolean; mono: boolean }>
  hasImages: boolean
}> {
  const page = await (await sourcePdf(docId, assetId)).getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: pixelsPerPoint })
  const content = await page.getTextContent()
  // Font objects (with their names) are available once the page's operators are loaded.
  const ops = await page.getOperatorList()
  const hasImages = ops.fnArray.some((fn) => IMAGE_OPS.has(fn))
  const fonts = new Map<string, { name: string; serif: boolean; mono: boolean }>()
  const runs: PdfTextRun[] = []
  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue
    const tx = Util.transform(viewport.transform, item.transform)
    const style = content.styles[item.fontName]
    if (style?.vertical) continue
    if (!fonts.has(item.fontName)) {
      const font = (page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : null) as {
        name?: string
        isSerifFont?: boolean
        isMonospace?: boolean
      } | null
      fonts.set(item.fontName, {
        name: font?.name ?? style?.fontFamily ?? '',
        serif: !!font?.isSerifFont,
        mono: !!font?.isMonospace
      })
    }
    runs.push({
      text: item.str,
      x: tx[4] as number,
      y: tx[5] as number,
      angle: (Math.atan2(tx[1] as number, tx[0] as number) * 180) / Math.PI,
      size: Math.hypot(tx[2] as number, tx[3] as number),
      width: item.width * pixelsPerPoint,
      font: item.fontName,
      ascent: style?.ascent ?? 0.8,
      descent: style?.descent ?? -0.2
    })
  }
  return { runs, fonts, hasImages }
}
