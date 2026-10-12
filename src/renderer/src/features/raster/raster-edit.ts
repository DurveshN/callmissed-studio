import type { Draft } from 'immer'
import type { ImageLayer, StudioDocument } from '@shared/document/model'
import type { MaskCrop } from '@shared/ml/jobs'
import { call } from '../../lib/ipc'
import { primeAssetImage } from '../assets/asset-cache'
import { newImageLayer } from '../document/factories'
import { notify } from '../../ui/notify'
import { runJob } from '../ml/ml-client'
import { useModelsStore } from '../models/models-store'
import { growMask, maskInRegion, maskRegion, type PixelRegion } from './mask'
import { cropPixels, encodePng, type RasterSnapshot } from './raster-target'

/** Stores PNG bytes as a new document asset (and primes the image cache with them). */
export async function writeAsset(docId: string, bytes: Uint8Array): Promise<string> {
  const assetId = crypto.randomUUID()
  await call('asset:write', { docId, assetId, mime: 'image/png', bytes })
  await primeAssetImage(assetId, bytes)
  return assetId
}

/**
 * Applies a raster edit inside a document commit; returns the index in the page's layers just above
 * the edited raster (where content taken from it belongs).
 */
export type RasterApply = (d: Draft<StudioDocument>) => number

/**
 * Writes edited pixels of a snapshot back: on the page as one patch per changed region (the original
 * stays untouched underneath), on an image layer as a new image for that layer. Assets are written
 * now; the returned function records them in the document inside the caller's commit.
 */
export async function writeRaster(
  docId: string,
  snap: RasterSnapshot,
  pixels: Uint8ClampedArray,
  regions: PixelRegion[]
): Promise<RasterApply> {
  const { width, height } = snap.image
  const target = snap.target
  if (target.kind === 'page') {
    const patches: (PixelRegion & { assetId: string })[] = []
    for (const r of regions) {
      const bytes = await encodePng(
        cropPixels({ width, data: pixels }, r.x, r.y, r.width, r.height),
        r.width,
        r.height
      )
      patches.push({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        assetId: await writeAsset(docId, bytes)
      })
    }
    return (d) => {
      const page = d.pages.find((p) => p.id === target.pageId)
      for (const patch of patches) {
        d.assets[patch.assetId] = { mime: 'image/png' }
        page?.patches.push({ id: crypto.randomUUID(), ...patch })
      }
      return 0
    }
  }
  const assetId = await writeAsset(docId, await encodePng(pixels, width, height))
  return (d) => {
    const page = d.pages.find((p) => p.id === target.pageId)
    const index = page?.layers.findIndex((l) => l.id === target.layerId) ?? -1
    const layer = page?.layers[index]
    if (layer?.type === 'image') {
      d.assets[assetId] = { mime: 'image/png' }
      layer.assetId = assetId
    }
    return index + 1
  }
}

/** An image layer showing `rgba` (a region of the snapshot) exactly where that region is on the page. */
export async function cutoutLayer(
  docId: string,
  snap: RasterSnapshot,
  rgba: Uint8ClampedArray,
  region: PixelRegion,
  name: string
): Promise<ImageLayer> {
  const assetId = await writeAsset(docId, await encodePng(rgba, region.width, region.height))
  const origin = snap.toPage({ x: region.x, y: region.y })
  const right = snap.toPage({ x: region.x + region.width, y: region.y })
  const down = snap.toPage({ x: region.x, y: region.y + region.height })
  return newImageLayer(
    assetId,
    name,
    {
      x: origin.x,
      y: origin.y,
      width: Math.hypot(right.x - origin.x, right.y - origin.y),
      height: Math.hypot(down.x - origin.x, down.y - origin.y),
      rotation: snap.rotation
    },
    'cutout'
  )
}

/** Grows erase masks: object outlines and brush strokes leave soft edges and shadows behind. */
const DEFAULT_GROW = 3

/**
 * Fills `mask` (snapshot pixels) from its surroundings. Returns a copy of the snapshot's pixels with
 * the area filled and the region that changed.
 */
export async function eraseMask(
  snap: RasterSnapshot,
  mask: MaskCrop,
  options: {
    quality: 'auto' | 'fast'
    grow?: number
    signal?: AbortSignal
    onProgress?: (p: number) => void
  }
): Promise<{ pixels: Uint8ClampedArray; region: PixelRegion; method: 'lama' | 'telea' }> {
  const { width, height, data } = snap.image
  const grown = growMask(mask, options.grow ?? DEFAULT_GROW, width, height)
  // Context for the fill: LaMa looks at about 1.6× the masked area.
  const context = maskRegion(grown, Math.max(32, 0.6 * Math.max(grown.width, grown.height)), width, height)
  const result = await runJob(
    'inpaint',
    {
      width: context.width,
      height: context.height,
      pixels: cropPixels(snap.image, context.x, context.y, context.width, context.height),
      mask: maskInRegion(grown, context),
      quality: options.quality
    },
    {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {})
    }
  )
  // Only the mask and LaMa's feathered edge (a few pixels) change.
  const changed = maskRegion(grown, 6, width, height)
  const pixels = new Uint8ClampedArray(data)
  for (let y = changed.y; y < changed.y + changed.height; y++) {
    const from = ((y - context.y) * context.width + changed.x - context.x) * 4
    pixels.set(result.pixels.subarray(from, from + changed.width * 4), (y * width + changed.x) * 4)
  }
  return { pixels, region: changed, method: result.method }
}

let eraserTipShown = false

/** After a fast (Telea) fill: suggests installing the high-quality eraser, once per session. */
export function suggestQualityEraser(): void {
  if (eraserTipShown) return
  if (useModelsStore.getState().statuses.find((s) => s.id === 'inpaint')?.state === 'installed') return
  eraserTipShown = true
  notify.info(
    'Tip: install the High-quality eraser in Settings for cleaner backgrounds where things were removed.'
  )
}

/** Index in the page's layers just above the target raster (0 above the page background). */
export function indexAbove(d: Draft<StudioDocument>, target: RasterSnapshot['target']): number {
  if (target.kind === 'page') return 0
  const page = d.pages.find((p) => p.id === target.pageId)
  return (page?.layers.findIndex((l) => l.id === target.layerId) ?? -1) + 1
}
