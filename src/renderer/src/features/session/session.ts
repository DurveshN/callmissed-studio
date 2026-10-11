import { PDF_RENDER_SCALE, type Page, type StudioDocument } from '@shared/document/model'
import type { OpenedProject, OpenedSource } from '@shared/ipc/contracts'
import { call } from '../../lib/ipc'
import { clearAssetCache, loadAssetImage } from '../assets/asset-cache'
import { clearPdfCache, openPdf, pdfPageSizes } from '../assets/pdf'
import { getHistory, useDocumentStore } from '../document/store'
import { renderThumbnail } from '../export/render-page'
import { flushAutosave } from './autosave'

async function documentFromSource(opened: OpenedSource): Promise<StudioDocument> {
  const name = opened.fileName.replace(/\.[^.]+$/, '') || 'Untitled'
  const blankPage = (width: number, height: number): Omit<Page, 'background'> => ({
    id: crypto.randomUUID(),
    width,
    height,
    patches: [],
    layers: []
  })

  let pages: Page[]
  if (opened.mime === 'application/pdf') {
    const bytes = await call('asset:read', { docId: opened.docId, assetId: opened.sourceAssetId })
    const pdf = await openPdf(bytes)
    try {
      const sizes = await pdfPageSizes(pdf)
      pages = sizes.map((s, pageIndex) => ({
        ...blankPage(s.width * PDF_RENDER_SCALE, s.height * PDF_RENDER_SCALE),
        background: { kind: 'pdf', pageIndex }
      }))
    } finally {
      await pdf.loadingTask.destroy()
    }
  } else {
    const img = await loadAssetImage(opened.docId, opened.sourceAssetId)
    pages = [
      {
        ...blankPage(img.naturalWidth, img.naturalHeight),
        background: { kind: 'image', assetId: opened.sourceAssetId }
      }
    ]
  }

  return {
    id: opened.docId,
    name,
    source: {
      kind: opened.mime === 'application/pdf' ? 'pdf' : 'image',
      fileName: opened.fileName,
      assetId: opened.sourceAssetId
    },
    assets: { [opened.sourceAssetId]: { mime: opened.mime } },
    pages,
    createdAt: new Date().toISOString()
  }
}

/** Closes whatever is open (without saving). */
export async function closeDocument(): Promise<void> {
  const { docId } = useDocumentStore.getState()
  useDocumentStore.getState().unload()
  clearAssetCache()
  clearPdfCache()
  if (docId) await call('workspace:close', { docId })
  await call('window:set-dirty', { dirty: false })
}

function loadProject(opened: OpenedProject, dirty: boolean): void {
  useDocumentStore.getState().load({
    docId: opened.docId,
    doc: opened.document,
    history: opened.history,
    projectPath: opened.projectPath,
    dirty
  })
}

/** Opens an image, PDF or .cmsp, replacing the current document. */
export async function openPath(path: string): Promise<void> {
  const opened = await call('workspace:open-path', { path })
  await closeDocument()
  if (opened.kind === 'project') {
    loadProject(opened, false)
    return
  }
  try {
    const doc = await documentFromSource(opened)
    useDocumentStore.getState().load({
      docId: opened.docId,
      doc,
      history: { undo: [], redo: [] },
      projectPath: null,
      dirty: false
    })
    await call('workspace:autosave', { docId: opened.docId, document: doc, history: getHistory() })
  } catch (error) {
    await call('workspace:close', { docId: opened.docId })
    throw error
  }
}

export async function recoverDocument(docId: string): Promise<void> {
  await closeDocument()
  // Recovered work was never saved to its project file, so it starts dirty.
  loadProject(await call('workspace:recover', { docId }), true)
}

/** Saves to the project file (asking for a path when needed). Returns false if cancelled. */
export async function saveDocument(saveAs = false): Promise<boolean> {
  const state = useDocumentStore.getState()
  if (!state.doc || !state.docId) return false
  await flushAutosave()
  const revision = state.revision
  const thumbnail = await renderThumbnail()
  const path = await call('project:save', {
    docId: state.docId,
    document: state.doc,
    history: getHistory(),
    thumbnail,
    saveAs
  })
  if (!path) return false
  // Only clean if nothing changed while the save was in flight.
  if (useDocumentStore.getState().revision === revision) useDocumentStore.getState().markSaved(path)
  else useDocumentStore.setState({ projectPath: path })
  return true
}
