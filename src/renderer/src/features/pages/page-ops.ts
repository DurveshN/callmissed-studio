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
