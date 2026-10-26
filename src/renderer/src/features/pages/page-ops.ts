import { PDF_RENDER_SCALE, type AssetMime, type Page } from '@shared/document/model'
import { call } from '../../lib/ipc'
import { attempt, notify } from '../../ui/notify'
import { loadAssetImage } from '../assets/asset-cache'
import { pdfAssetPageSizes } from '../assets/pdf'
import { useDocumentStore } from '../document/store'

/** Moves a page to position `to` (0-based) in the document. One undo step. */
export function movePage(pageId: string, to: number): void {
  const { doc } = useDocumentStore.getState()
  const from = doc?.pages.findIndex((p) => p.id === pageId) ?? -1
  if (!doc || from < 0) return
  const target = Math.max(0, Math.min(doc.pages.length - 1, to))
  if (target === from) return
  useDocumentStore.getState().commit('Move page', (d) => {
    const [page] = d.pages.splice(from, 1)
    if (page) d.pages.splice(target, 0, page)
  })
}

/** Removes a page (never the last one). One undo step. */
export function deletePage(pageId: string): void {
  const { doc, activePageId } = useDocumentStore.getState()
  const index = doc?.pages.findIndex((p) => p.id === pageId) ?? -1
  if (!doc || index < 0 || doc.pages.length <= 1) return
  const next = doc.pages[index + 1] ?? doc.pages[index - 1]
  useDocumentStore.getState().commit('Delete page', (d) => {
    d.pages.splice(index, 1)
  })
  if (activePageId === pageId && next) useDocumentStore.getState().setActivePage(next.id)
}

/** Shows the page `delta` pages before or after the current one (clamped to the document). */
export function stepPage(delta: number): void {
  const { doc, activePageId, setActivePage } = useDocumentStore.getState()
  if (!doc) return
  const index = Math.max(
    0,
    doc.pages.findIndex((p) => p.id === activePageId)
  )
  const next = doc.pages[Math.max(0, Math.min(doc.pages.length - 1, index + delta))]
  if (next && next.id !== activePageId) setActivePage(next.id)
}

/** Inserts `pages` at `index` (one undo step, registering `assets`) and shows the first of them. */
function insertPages(
  index: number,
  pages: Page[],
  label: string,
  assets: Record<string, { mime: AssetMime }> = {}
): void {
  const first = pages[0]
  if (!first) return
  useDocumentStore.getState().commit(label, (d) => {
    Object.assign(d.assets, assets)
    d.pages.splice(index, 0, ...pages)
  })
  useDocumentStore.getState().setActivePage(first.id)
}

/** A blank (white) page the size of page `index`, inserted after it. */
export function insertBlankPage(index: number): void {
  const { doc } = useDocumentStore.getState()
  const like = doc?.pages[index]
  if (!doc || !like) return
  // A blank page is a white picture, so it behaves like any image page (export, tools).
  void attempt(async () => {
    const canvas = new OffscreenCanvas(Math.round(like.width), Math.round(like.height))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    const assetId = crypto.randomUUID()
    await call('asset:write', { docId: doc.id, assetId, mime: 'image/png', bytes })
    const page: Page = {
      id: crypto.randomUUID(),
      width: canvas.width,
      height: canvas.height,
      background: { kind: 'image', assetId },
      patches: [],
      layers: []
    }
    insertPages(index + 1, [page], 'Add blank page', { [assetId]: { mime: 'image/png' } })
  }, 'Could not add a page')
}

/** A copy of page `pageId` (its layers get new ids), inserted after it. */
export function duplicatePage(pageId: string): void {
  const { doc } = useDocumentStore.getState()
  const index = doc?.pages.findIndex((p) => p.id === pageId) ?? -1
  const page = doc?.pages[index]
  if (!page) return
  // Assets are never changed in place, so the copy can share them.
  const copy: Page = structuredClone(page)
  copy.id = crypto.randomUUID()
  for (const item of [...copy.layers, ...copy.patches]) item.id = crypto.randomUUID()
  insertPages(index + 1, [copy], 'Duplicate page')
}

/**
 * Asks for PDFs and images and inserts their pages at `index` (every page of each PDF, one page per
 * picture), in the order chosen. One undo step.
 */
export async function insertPagesFromFiles(index: number): Promise<void> {
  const { docId } = useDocumentStore.getState()
  if (!docId) return
  await attempt(async () => {
    const paths = await call('file:pick-pages')
    if (paths.length === 0) return
    const pages: Page[] = []
    const assets: Record<string, { mime: AssetMime }> = {}
    const blank = (width: number, height: number) => ({
      id: crypto.randomUUID(),
      width,
      height,
      patches: [],
      layers: []
    })
    for (const path of paths) {
      const file = await call('workspace:import-pages', { docId, path })
      assets[file.assetId] = { mime: file.mime }
      if (file.mime === 'application/pdf') {
        const sizes = await pdfAssetPageSizes(docId, file.assetId)
        sizes.forEach((s, pageIndex) =>
          pages.push({
            ...blank(s.width * PDF_RENDER_SCALE, s.height * PDF_RENDER_SCALE),
            background: { kind: 'pdf', pageIndex, assetId: file.assetId }
          })
        )
      } else {
        const img = await loadAssetImage(docId, file.assetId)
        pages.push({
          ...blank(img.naturalWidth, img.naturalHeight),
          background: { kind: 'image', assetId: file.assetId }
        })
      }
    }
    insertPages(index, pages, pages.length === 1 ? 'Insert page' : `Insert ${pages.length} pages`, assets)
    notify.info(pages.length === 1 ? 'Inserted 1 page' : `Inserted ${pages.length} pages`)
  }, 'Could not insert the pages')
}
