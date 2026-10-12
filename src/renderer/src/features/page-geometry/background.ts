import type { Page, StudioDocument } from '@shared/document/model'
import { notify } from '../../ui/notify'
import { loadAssetImage } from '../assets/asset-cache'
import { newImageLayer } from '../document/factories'
import { selectActivePage, useDocumentStore } from '../document/store'
import { clearSelection } from '../magic-select/magic-select'
import { writeAsset } from '../raster/raster-edit'
import { encodePng, snapshot } from '../raster/raster-target'
import { cancelDetect } from '../text-detect/detect'
import { enqueue, MAX_PAGE_SIDE } from './page-ops'
import { reframeLayer } from './transform'

/** The page picture as one image asset: the background itself when nothing is painted over it. */
async function pictureAsset(doc: StudioDocument, docId: string, page: Page): Promise<string> {
  if (page.background.kind === 'image' && page.patches.length === 0) return page.background.assetId
  const snap = await snapshot(doc, { kind: 'page', pageId: page.id })
  return writeAsset(docId, await encodePng(snap.image.data, snap.image.width, snap.image.height))
}

/**
 * Makes image layer `layerId` the page: the page takes that image's own size, the previous page
 * picture becomes an ordinary layer, and every layer stays exactly where it was on screen. One undo step.
 */
export function setAsBackground(layerId: string): Promise<void> {
  return enqueue(async () => {
    const { doc, docId } = useDocumentStore.getState()
    const page = selectActivePage(useDocumentStore.getState())
    const chosen = page?.layers.find((l) => l.id === layerId)
    if (!doc || !docId || !page || chosen?.type !== 'image') return
    try {
      const image = await loadAssetImage(docId, chosen.assetId)
      const width = image.naturalWidth
      const height = image.naturalHeight
      if (width > MAX_PAGE_SIDE || height > MAX_PAGE_SIDE) {
        notify.info(`Images larger than ${MAX_PAGE_SIDE} px on a side can't be the page.`)
        return
      }
      cancelDetect()
      clearSelection()
      // The new page frame: the chosen layer's position, turn and scale (page units per image pixel).
      const frame = { x: chosen.x, y: chosen.y, rotation: chosen.rotation, scale: chosen.width / width }
      const previous = newImageLayer(await pictureAsset(doc, docId, page), 'Previous background', {
        x: 0,
        y: 0,
        width: page.width,
        height: page.height
      })
      if (page.adjustments) previous.adjustments = { ...page.adjustments }
      const layers = [previous, ...page.layers.filter((l) => l.id !== layerId)].map((l) =>
        reframeLayer(l, frame)
      )

      useDocumentStore.getState().commit('Set as background', (d) => {
        const target = d.pages.find((p) => p.id === page.id)
        if (!target) return
        d.assets[previous.assetId] ??= { mime: 'image/png' }
        target.background = { kind: 'image', assetId: chosen.assetId }
        target.patches = []
        target.width = width
        target.height = height
        if (chosen.adjustments) target.adjustments = { ...chosen.adjustments }
        else delete target.adjustments
        target.layers = layers
      })
      useDocumentStore.getState().select([])
    } catch (error) {
      notify.error(error, 'Could not set the background')
    }
  })
}

/** Moves the page picture to an ordinary layer (movable, resizable) over a blank page. One undo step. */
export function detachBackground(): Promise<void> {
  return enqueue(async () => {
    const { doc, docId } = useDocumentStore.getState()
    const page = selectActivePage(useDocumentStore.getState())
    if (!doc || !docId || !page) return
    try {
      cancelDetect()
      clearSelection()
      const layer = newImageLayer(await pictureAsset(doc, docId, page), 'Background', {
        x: 0,
        y: 0,
        width: page.width,
        height: page.height
      })
      if (page.adjustments) layer.adjustments = { ...page.adjustments }
      const w = Math.round(page.width)
      const h = Math.round(page.height)
      const blank = await writeAsset(docId, await encodePng(new Uint8ClampedArray(w * h * 4).fill(255), w, h))
      useDocumentStore.getState().commit('Make background a layer', (d) => {
        const target = d.pages.find((p) => p.id === page.id)
        if (!target) return
        d.assets[layer.assetId] ??= { mime: 'image/png' }
        d.assets[blank] = { mime: 'image/png' }
        target.background = { kind: 'image', assetId: blank }
        target.patches = []
        delete target.adjustments
        target.layers.unshift(layer)
      })
      useDocumentStore.getState().select([layer.id])
    } catch (error) {
      notify.error(error, 'Could not make the background a layer')
    }
  })
}
