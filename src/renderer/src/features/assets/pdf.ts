import { useEffect, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
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
