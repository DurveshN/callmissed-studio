import { create } from 'zustand'
import { notify } from '../../ui/notify'
import { selectActivePage, useDocumentStore } from '../document/store'
import { strokeMask, type Point } from '../raster/mask'
import { eraseMask, suggestQualityEraser, writeRaster } from '../raster/raster-edit'
import { snapshot, targetAt } from '../raster/raster-target'

interface EraserState {
  /** Brush diameter in screen pixels. */
  size: number
  /** 'auto' fills with LaMa when installed (best), 'fast' always uses the instant fill. */
  quality: 'auto' | 'fast'
  status: 'idle' | 'working'
  progress: number | null
}

export const useEraserStore = create<EraserState>()(() => ({
  size: 40,
  quality: 'auto',
  status: 'idle',
  progress: null
}))

export const BRUSH_SIZES = { min: 6, max: 300 } as const

/** Strokes are erased one after another, each from the result of the previous one. */
let queue: Promise<void> = Promise.resolve()

/** Erases what a brush of `radius` (page units) painted along `points` (page coordinates). */
export function eraseStroke(points: Point[], radius: number): void {
  queue = queue.then(async () => {
    const { doc, docId } = useDocumentStore.getState()
    const page = selectActivePage(useDocumentStore.getState())
    const first = points[0]
    if (!doc || !docId || !page || !first) return
    try {
      // The stroke edits the picture it starts on: an image layer, or the page.
      const snap = await snapshot(doc, targetAt(page, first))
      const { width, height } = snap.image
      const mask = strokeMask(points.map(snap.fromPage), radius / snap.scale, width, height)
      if (!mask) return
      const { quality } = useEraserStore.getState()
      useEraserStore.setState({ status: 'working', progress: 0 })
      const erased = await eraseMask(snap, mask, {
        quality,
        grow: 1,
        onProgress: (progress) => useEraserStore.setState({ progress })
      })
      const write = await writeRaster(docId, snap, erased.pixels, [erased.region])
      useDocumentStore.getState().commit('Erase', (d) => void write(d))
      if (erased.method === 'telea' && quality === 'auto') suggestQualityEraser()
    } catch (error) {
      notify.error(error, 'Could not erase')
    } finally {
      useEraserStore.setState({ status: 'idle', progress: null })
    }
  })
}
