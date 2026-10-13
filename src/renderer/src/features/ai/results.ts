import type { Generation, StudioDocument } from '@shared/document/model'
import { call } from '../../lib/ipc'
import { confirm } from '../../ui/confirm'
import { attempt, notify } from '../../ui/notify'
import { loadAssetImage } from '../assets/asset-cache'
import { newImageLayer } from '../document/factories'
import { addLayer } from '../document/layer-ops'
import { selectActivePage, useDocumentStore } from '../document/store'
import { useCompare } from './compare'

/**
 * Makes an AI result the current page: it already shows everything that was on the page (the page
 * was sent with its edits), so the picture replaces the page's picture, edits and layers. The page
 * keeps its width; its height follows the result's shape. One undo step.
 */
export function applyAsPage(generation: Generation): Promise<void> {
  return attempt(async () => {
    const { doc, docId } = useDocumentStore.getState()
    const page = selectActivePage(useDocumentStore.getState())
    if (!doc || !docId || !page) return
    const image = await loadAssetImage(docId, generation.assetId)
    const height = Math.round((page.width * image.naturalHeight) / image.naturalWidth)
    useDocumentStore.getState().commit('Use AI result as page', (d) => {
      const target = d.pages.find((p) => p.id === page.id)
      if (!target) return
      target.background = { kind: 'image', assetId: generation.assetId }
      target.height = height
      target.patches = []
      target.layers = []
      delete target.adjustments
    })
    useCompare.setState({ generationId: null })
  }, 'Could not use the result')
}

/** Adds an AI result as an image layer fitted over the current page. One undo step. */
export function addAsLayer(generation: Generation): Promise<void> {
  return attempt(async () => {
    const { docId } = useDocumentStore.getState()
    const page = selectActivePage(useDocumentStore.getState())
    if (!docId || !page) return
    const image = await loadAssetImage(docId, generation.assetId)
    const scale = Math.min(page.width / image.naturalWidth, page.height / image.naturalHeight)
    const width = image.naturalWidth * scale
    const height = image.naturalHeight * scale
    addLayer(
      newImageLayer(
        generation.assetId,
        'AI result',
        { x: (page.width - width) / 2, y: (page.height - height) / 2, width, height },
        'ai'
      ),
      'Add AI result'
    )
  }, 'Could not add the result')
}

/** Saves the result's picture as a file. */
export function exportResult(generation: Generation): Promise<void> {
  return attempt(async () => {
    const { doc, docId } = useDocumentStore.getState()
    if (!doc || !docId) return
    const bytes = await call('asset:read', { docId, assetId: generation.assetId })
    const jpeg = doc.assets[generation.assetId]?.mime === 'image/jpeg'
    const path = await call('export:save-image', {
      bytes,
      suggestedName: `${doc.name}-ai`,
      format: jpeg ? 'jpeg' : 'png'
    })
    if (path) notify.info('Exported')
  }, 'Export failed')
}

/** Whether anything in the document (a page, patch or layer) shows `assetId`. */
function inUse(doc: StudioDocument, assetId: string): boolean {
  return doc.pages.some(
    (p) =>
      (p.background.kind === 'image' && p.background.assetId === assetId) ||
      p.patches.some((patch) => patch.assetId === assetId) ||
      p.layers.some((l) => l.type === 'image' && l.assetId === assetId)
  )
}

/** Removes a result from the AI tab (after asking: it was paid for). */
export async function deleteResult(generation: Generation): Promise<void> {
  const choice = await confirm({
    title: 'Delete this AI result?',
    message: 'It will be removed from this project. This cannot be undone.',
    choices: [
      { id: 'delete', label: 'Delete' },
      { id: 'cancel', label: 'Cancel' }
    ] as const,
    cancel: 'cancel'
  })
  if (choice !== 'delete') return
  if (useCompare.getState().generationId === generation.id) useCompare.setState({ generationId: null })
  useDocumentStore.getState().record((d) => {
    d.generations = (d.generations ?? []).filter((g) => g.id !== generation.id)
    // Keep the picture if a page or layer shows it (it was used as a page or added as a layer).
    if (!inUse(d as StudioDocument, generation.assetId)) {
      d.assets = Object.fromEntries(Object.entries(d.assets).filter(([id]) => id !== generation.assetId))
    }
  })
}
