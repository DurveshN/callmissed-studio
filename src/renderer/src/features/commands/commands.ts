import { call } from '../../lib/ipc'
import { confirm } from '../../ui/confirm'
import { attempt, notify } from '../../ui/notify'
import { loadAssetImage } from '../assets/asset-cache'
import { fitCentered, newImageLayer } from '../document/factories'
import { addLayer } from '../document/layer-ops'
import { selectActivePage, selectIsDirty, useDocumentStore } from '../document/store'
import { encodeActivePage, type ExportFormat } from '../export/render-page'
import { closeDocument, openPath, recoverDocument, saveDocument } from '../session/session'
import { useViewportStore } from '../canvas/viewport-store'

/** Asks to save unsaved work. Resolves false if the user cancelled. */
async function resolveUnsaved(): Promise<boolean> {
  if (!selectIsDirty(useDocumentStore.getState())) return true
  const choice = await confirm({
    title: 'Unsaved changes',
    message: `Save changes to “${useDocumentStore.getState().doc?.name ?? 'document'}” first?`,
    choices: [
      { id: 'save', label: 'Save' },
      { id: 'discard', label: 'Don’t save' },
      { id: 'cancel', label: 'Cancel' }
    ] as const,
    cancel: 'cancel'
  })
  if (choice === 'cancel') return false
  if (choice === 'save') return saveDocument()
  return true
}

export const commands = {
  async openDialog(): Promise<void> {
    await attempt(async () => {
      const path = await call('file:pick-open')
      if (path) await commands.openPath(path)
    })
  },

  async openPath(path: string): Promise<void> {
    await attempt(async () => {
      if (!(await resolveUnsaved())) return
      await openPath(path)
    }, 'Could not open the file')
  },

  async recover(docId: string): Promise<void> {
    await attempt(() => recoverDocument(docId), 'Could not recover the document')
  },

  async discardRecovery(docId: string): Promise<void> {
    await attempt(() => call('workspace:discard', { docId }))
  },

  async save(saveAs = false): Promise<boolean> {
    let saved = false
    await attempt(async () => {
      saved = await saveDocument(saveAs)
      if (saved) notify.info('Saved')
    }, 'Could not save the project')
    return saved
  },

  async close(): Promise<void> {
    await attempt(async () => {
      if (await resolveUnsaved()) await closeDocument()
    })
  },

  /** Main asked to save before the window closes. */
  async saveAndClose(): Promise<void> {
    if (await commands.save()) await call('window:close-confirmed')
  },

  async insertImage(): Promise<void> {
    await attempt(async () => {
      const { docId } = useDocumentStore.getState()
      const page = selectActivePage(useDocumentStore.getState())
      if (!docId || !page) return
      const path = await call('file:pick-image')
      if (!path) return
      const imported = await call('workspace:import-image', { docId, path })
      const img = await loadAssetImage(docId, imported.assetId)
      const layer = newImageLayer(
        imported.assetId,
        imported.fileName.replace(/\.[^.]+$/, ''),
        fitCentered(img.naturalWidth, img.naturalHeight, page.width, page.height)
      )
      addLayer(layer, 'Insert image', (d) => {
        d.assets[imported.assetId] = { mime: imported.mime }
      })
    }, 'Could not insert the image')
  },

  async exportPage(format: ExportFormat, scale: number, quality: number): Promise<void> {
    await attempt(async () => {
      const { doc } = useDocumentStore.getState()
      if (!doc) return
      const bytes = await encodeActivePage(format, scale, quality)
      const page = doc.pages.findIndex((p) => p.id === useDocumentStore.getState().activePageId)
      const suffix = doc.pages.length > 1 ? `-page-${page + 1}` : ''
      const path = await call('export:save-image', { bytes, suggestedName: `${doc.name}${suffix}`, format })
      if (path) notify.info('Exported')
    }, 'Export failed')
  },

  undo: () => useDocumentStore.getState().undo(),
  redo: () => useDocumentStore.getState().redo(),

  fit(): void {
    const page = selectActivePage(useDocumentStore.getState())
    if (page) useViewportStore.getState().fit(page.width, page.height)
  },
  zoomIn: () => useViewportStore.getState().zoomBy(1.25),
  zoomOut: () => useViewportStore.getState().zoomBy(0.8),
  actualSize: () => useViewportStore.getState().zoomTo(1)
}
