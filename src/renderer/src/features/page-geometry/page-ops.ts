import type { Draft } from 'immer'
import type { Layer, Page, StudioDocument } from '@shared/document/model'
import { notify } from '../../ui/notify'
import { loadAssetImage } from '../assets/asset-cache'
import { selectActivePage, useDocumentStore } from '../document/store'
import { clearSelection } from '../magic-select/magic-select'
import { writeAsset } from '../raster/raster-edit'
import { snapshot } from '../raster/raster-target'
import { cancelDetect } from '../text-detect/detect'
import { clampBox, croppedLayerBox, rotateLayer, scaleLayer, shiftLayer, type Box } from './transform'

/** Largest page side the editor accepts (matches the ML job limits). */
export const MAX_PAGE_SIDE = 16384
export const MIN_PAGE_SIDE = 16

function canvas(width: number, height: number): OffscreenCanvasRenderingContext2D {
  const ctx = new OffscreenCanvas(width, height).getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is unavailable')
  ctx.imageSmoothingQuality = 'high'
  return ctx
}

async function pngAsset(docId: string, ctx: OffscreenCanvasRenderingContext2D): Promise<string> {
  const blob = await ctx.canvas.convertToBlob({ type: 'image/png' })
  return writeAsset(docId, new Uint8Array(await blob.arrayBuffer()))
}

/** Page operations run one at a time, each on the document as the previous one left it. */
let queue: Promise<void> = Promise.resolve()

function enqueue(work: () => Promise<void>): Promise<void> {
  const run = queue.then(work)
  queue = run.catch(() => undefined)
  return run
}

interface Rebuild {
  label: string
  width: number
  height: number
  /** Draws the old picture into the new one. */
  draw(ctx: OffscreenCanvasRenderingContext2D, picture: OffscreenCanvas): void
  /** Maps a layer into the new geometry. */
  layer(layer: Layer): Layer
}

/**
 * Bakes the page picture (background + patches) into a new image as `plan` describes for the page as
 * it is when the operation starts (null: nothing to do), makes it the page's background and maps
 * every layer into the new geometry. One undo step.
 */
function rebuildPage(plan: (page: Page) => Rebuild | null): Promise<void> {
  return enqueue(async () => {
    const state = useDocumentStore.getState()
    const page = selectActivePage(state)
    const { doc, docId } = state
    if (!page || !doc || !docId) return
    const op = plan(page)
    if (!op) return
    const w = Math.round(op.width)
    const h = Math.round(op.height)
    if (w < MIN_PAGE_SIDE || h < MIN_PAGE_SIDE || w > MAX_PAGE_SIDE || h > MAX_PAGE_SIDE) {
      notify.info(`Pages must be ${MIN_PAGE_SIDE}–${MAX_PAGE_SIDE} px on each side.`)
      return
    }
    // Detected lines and object selections refer to the old geometry.
    cancelDetect()
    clearSelection()
    try {
      const snap = await snapshot(doc, { kind: 'page', pageId: page.id })
      const picture = new OffscreenCanvas(snap.image.width, snap.image.height)
      picture.getContext('2d')?.putImageData(snap.image, 0, 0)
      const ctx = canvas(w, h)
      op.draw(ctx, picture)
      const assetId = await pngAsset(docId, ctx)
      useDocumentStore.getState().commit(op.label, (d: Draft<StudioDocument>) => {
        const target = d.pages.find((p) => p.id === page.id)
        if (!target) return
        d.assets[assetId] = { mime: 'image/png' }
        target.background = { kind: 'image', assetId }
        target.patches = []
        target.width = w
        target.height = h
        target.layers = page.layers.map(op.layer)
      })
    } catch (error) {
      notify.error(error, `${op.label} failed`)
    }
  })
}

/** Turns the page and everything on it 90° clockwise (`cw`) or counter-clockwise. */
export function rotatePage(cw: boolean): Promise<void> {
  return rebuildPage((page) => ({
    label: cw ? 'Rotate page right' : 'Rotate page left',
    width: page.height,
    height: page.width,
    draw: (ctx, picture) => {
      ctx.translate(cw ? page.height : 0, cw ? 0 : page.width)
      ctx.rotate(((cw ? 90 : -90) * Math.PI) / 180)
      ctx.drawImage(picture, 0, 0, page.width, page.height)
    },
    layer: (layer) => rotateLayer(layer, cw, page.width, page.height)
  }))
}

/**
 * Scales the page and everything on it to `size.width` or `size.height` px (aspect ratio kept).
 * Asking again for the size the page already has does nothing.
 */
export function resizePage(size: { width: number } | { height: number }): Promise<void> {
  return rebuildPage((page) => {
    const scale = 'width' in size ? size.width / page.width : size.height / page.height
    if (!(scale > 0) || Math.abs(scale - 1) < 1e-6) return null
    const width = Math.round(page.width * scale)
    const height = Math.round(page.height * scale)
    return {
      label: 'Resize page',
      width,
      height,
      draw: (ctx, picture) => ctx.drawImage(picture, 0, 0, width, height),
      layer: (layer) => scaleLayer(layer, scale)
    }
  })
}

/** Crops the page to `box` (page units); layers keep their place over the picture. */
export function cropPage(box: Box): Promise<void> {
  return rebuildPage((page) => {
    const b = clampBox(
      {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height)
      },
      page.width,
      page.height
    )
    return {
      label: 'Crop page',
      width: b.width,
      height: b.height,
      draw: (ctx, picture) => ctx.drawImage(picture, -b.x, -b.y),
      layer: (layer) => shiftLayer(layer, -b.x, -b.y)
    }
  })
}

/** Crops an image layer to `box` (in its own unrotated units); the kept part stays where it was. */
export function cropImageLayer(layerId: string, box: Box): Promise<void> {
  return enqueue(async () => {
    const state = useDocumentStore.getState()
    const page = selectActivePage(state)
    const { docId } = state
    const layer = page?.layers.find((l) => l.id === layerId)
    if (!page || !docId || layer?.type !== 'image') return
    clearSelection()
    try {
      const image = await loadAssetImage(docId, layer.assetId)
      const b = clampBox(box, layer.width, layer.height)
      const sx = image.naturalWidth / layer.width
      const sy = image.naturalHeight / layer.height
      const w = Math.max(1, Math.round(b.width * sx))
      const h = Math.max(1, Math.round(b.height * sy))
      const ctx = canvas(w, h)
      ctx.drawImage(image, b.x * sx, b.y * sy, b.width * sx, b.height * sy, 0, 0, w, h)
      const assetId = await pngAsset(docId, ctx)
      const placed = croppedLayerBox(layer, b)
      useDocumentStore.getState().commit('Crop image', (d) => {
        const target = d.pages.find((p) => p.id === page.id)?.layers.find((l) => l.id === layerId)
        if (target?.type !== 'image') return
        d.assets[assetId] = { mime: 'image/png' }
        Object.assign(target, placed, { assetId })
      })
    } catch (error) {
      notify.error(error, 'Crop failed')
    }
  })
}
