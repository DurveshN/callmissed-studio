import { create } from 'zustand'
import { selectActivePage, useDocumentStore } from '../document/store'
import { currentTarget, type RasterTarget } from '../raster/raster-target'
import { useToolStore } from '../tools/tool-store'
import { cropImageLayer, cropPage } from './page-ops'
import type { Box } from './transform'

interface CropState {
  /** The page, or the image layer being cropped. */
  target: RasterTarget | null
  /** Kept area: page units for the page, the layer's own unrotated units for a layer. */
  box: Box | null
}

export const useCropStore = create<CropState>()(() => ({ target: null, box: null }))

/** Size of the crop target in the units of its crop box. */
function extent(target: RasterTarget): { width: number; height: number } | null {
  const page = selectActivePage(useDocumentStore.getState())
  if (!page || page.id !== target.pageId) return null
  if (target.kind === 'page') return { width: page.width, height: page.height }
  const layer = page.layers.find((l) => l.id === target.layerId)
  return layer?.type === 'image' ? { width: layer.width, height: layer.height } : null
}

/** Starts cropping the selected image layer, or the page, with everything kept. */
function begin(): void {
  const state = useDocumentStore.getState()
  const page = selectActivePage(state)
  if (!page) return
  const target = currentTarget(page, state.selection)
  const size = extent(target)
  useCropStore.setState({ target, box: size ? { x: 0, y: 0, ...size } : null })
}

export function cancelCrop(): void {
  useToolStore.getState().setTool('select')
}

export async function applyCrop(): Promise<void> {
  const { target, box } = useCropStore.getState()
  const size = target && extent(target)
  useToolStore.getState().setTool('select')
  if (!target || !box || !size) return
  const unchanged = box.x === 0 && box.y === 0 && box.width === size.width && box.height === size.height
  if (unchanged) return
  if (target.kind === 'page') await cropPage(box)
  else await cropImageLayer(target.layerId, box)
}

// The Crop tool starts on the current selection and ends (without cropping) when another tool is chosen.
useToolStore.subscribe((state, previous) => {
  if (state.tool === 'crop' && previous.tool !== 'crop') begin()
  if (state.tool !== 'crop' && previous.tool === 'crop') useCropStore.setState({ target: null, box: null })
})
