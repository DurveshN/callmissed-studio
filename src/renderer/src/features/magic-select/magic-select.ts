import type { ImageLayer, StudioDocument } from '@shared/document/model'
import { notify } from '../../ui/notify'
import { selectActivePage, useDocumentStore } from '../document/store'
import { MlError, runJob } from '../ml/ml-client'
import { ensureModel } from '../models/ensure-model'
import { cutoutPixels, featherMask } from '../raster/mask'
import {
  cutoutLayer,
  eraseMask,
  indexAbove,
  suggestQualityEraser,
  writeRaster,
  type RasterApply
} from '../raster/raster-edit'
import {
  sameTarget,
  snapshot,
  targetAt,
  type Point,
  type RasterSnapshot,
  type RasterTarget
} from '../raster/raster-target'
import { useToolStore } from '../tools/tool-store'
import { initialSelect, useSelectStore, type Placement, type PromptPoint } from './select-store'

/** The encoded raster (the worker keeps its embeddings under `key`). */
let prepared: { snap: RasterSnapshot; key: string; version: string } | null = null
/** Operations run one at a time, in click order. */
let queue: Promise<void> = Promise.resolve()

function enqueue(work: () => Promise<void>): void {
  queue = queue.then(work).catch((error: unknown) => {
    useSelectStore.setState({ status: 'error', progress: null, message: 'Selection failed.' })
    notify.error(error, 'Could not select the object')
  })
}

/** Identifies the target's pixels and placement; a selection is dropped when they change. */
export function rasterVersion(doc: StudioDocument, target: RasterTarget): string {
  const page = doc.pages.find((p) => p.id === target.pageId)
  if (!page) return ''
  if (target.kind === 'page') {
    return JSON.stringify([page.width, page.height, page.background, page.patches.map((p) => p.id)])
  }
  const layer = page.layers.find((l) => l.id === target.layerId)
  return layer?.type === 'image'
    ? JSON.stringify([layer.assetId, layer.x, layer.y, layer.width, layer.height, layer.rotation])
    : ''
}

function reset(): void {
  prepared = null
  useSelectStore.setState(initialSelect)
}

/** Clears the selection (ignored while an action on it is being applied; that finishes first). */
export function clearSelection(): void {
  if (useSelectStore.getState().status !== 'applying') reset()
}

function placementOf(snap: RasterSnapshot): Placement {
  const origin = snap.toPage({ x: 0, y: 0 })
  const right = snap.toPage({ x: 1, y: 0 })
  const down = snap.toPage({ x: 0, y: 1 })
  return {
    x: origin.x,
    y: origin.y,
    rotation: (Math.atan2(right.y - origin.y, right.x - origin.x) * 180) / Math.PI,
    scaleX: Math.hypot(right.x - origin.x, right.y - origin.y),
    scaleY: Math.hypot(down.x - origin.x, down.y - origin.y)
  }
}

/** Encodes the target raster once (downloading the model first if needed). */
async function prepare(target: RasterTarget): Promise<RasterSnapshot | null> {
  const doc = useDocumentStore.getState().doc
  if (!doc) return null
  const version = rasterVersion(doc, target)
  if (prepared && sameTarget(prepared.snap.target, target) && prepared.version === version)
    return prepared.snap
  prepared = null
  useSelectStore.setState({ ...initialSelect, status: 'preparing', target, message: 'Analyzing the image…' })
  const ready = await ensureModel('segment', 'Selecting objects', (progress) =>
    useSelectStore.setState({ progress, message: 'Downloading the object selection model…' })
  )
  if (!ready) {
    reset()
    return null
  }
  useSelectStore.setState({ progress: null, message: 'Analyzing the image…' })
  const snap = await snapshot(doc, target)
  const key = crypto.randomUUID()
  const { width, height, data } = snap.image
  await runJob('segment-prepare', { key, width, height, pixels: new Uint8Array(data.buffer.slice(0)) })
  prepared = { snap, key, version }
  useSelectStore.setState({ placement: placementOf(snap) })
  return snap
}

async function decode(target: RasterTarget, points: PromptPoint[], box: PromptBox | null): Promise<void> {
  useSelectStore.setState({ status: 'selecting', target, points, box, progress: null, message: null })
  const run = async () => {
    if (!prepared) throw new MlError('NOT_PREPARED', 'Image not prepared')
    return runJob('segment', { key: prepared.key, points, ...(box ? { box } : {}) })
  }
  let result
  try {
    result = await run()
  } catch (error) {
    // The worker restarted (or evicted the image): encode again and retry once.
    if (!(error instanceof MlError && error.code === 'NOT_PREPARED')) throw error
    prepared = null
    if (!(await prepare(target))) return
    useSelectStore.setState({ status: 'selecting', target, points, box })
    result = await run()
  }
  useSelectStore.setState({
    status: 'ready',
    mask: result.mask,
    message: result.mask ? null : 'Nothing found there. Click inside the object, or drag a box around it.'
  })
}

type PromptBox = { x0: number; y0: number; x1: number; y1: number }

const inside = (snap: RasterSnapshot, p: Point) =>
  p.x >= 0 && p.y >= 0 && p.x < snap.image.width && p.y < snap.image.height

/**
 * Selects the object at page point `p`: 'new' starts over (on the image under the click), 'add' and
 * 'subtract' refine the current selection.
 */
export function selectAt(p: Point, mode: 'new' | 'add' | 'subtract'): void {
  enqueue(async () => {
    const page = selectActivePage(useDocumentStore.getState())
    if (!page) return
    const current = useSelectStore.getState()
    const refine = mode !== 'new' && current.target !== null && current.status === 'ready'
    const target = refine && current.target ? current.target : targetAt(page, p)
    const snap = await prepare(target)
    if (!snap) return
    const at = snap.fromPage(p)
    if (!inside(snap, at)) {
      if (!refine)
        useSelectStore.setState({ status: 'ready', message: 'Click on the picture to select something.' })
      return
    }
    const point: PromptPoint = { x: at.x, y: at.y, label: mode === 'subtract' ? 0 : 1 }
    const kept = refine ? useSelectStore.getState() : null
    await decode(target, kept ? [...kept.points, point] : [point], kept?.box ?? null)
  })
}

/** Selects the main object inside the box dragged from page point `a` to `b`. */
export function selectBox(a: Point, b: Point): void {
  enqueue(async () => {
    const page = selectActivePage(useDocumentStore.getState())
    if (!page) return
    const target = targetAt(page, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    const snap = await prepare(target)
    if (!snap) return
    const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }].map(snap.fromPage)
    const xs = corners.map((c) => Math.min(snap.image.width, Math.max(0, c.x)))
    const ys = corners.map((c) => Math.min(snap.image.height, Math.max(0, c.y)))
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
    if (box.x1 - box.x0 < 2 || box.y1 - box.y0 < 2) return
    await decode(target, [], box)
  })
}

export type ObjectAction = 'copy' | 'cut' | 'delete'

const LABELS: Record<ObjectAction, string> = {
  copy: 'Copy object to layer',
  cut: 'Cut object to layer',
  delete: 'Remove object'
}

/** Copies the selected object to a new layer, cuts it out (filling the hole), or removes it. */
export function applySelection(action: ObjectAction): void {
  enqueue(async () => {
    const { mask } = useSelectStore.getState()
    const { doc, docId } = useDocumentStore.getState()
    if (!prepared || !mask || !doc || !docId) return
    const { snap } = prepared
    if (rasterVersion(doc, snap.target) !== prepared.version) {
      reset()
      notify.info('The picture changed, so the selection was cleared. Select the object again.')
      return
    }
    const { width, height, data } = snap.image
    useSelectStore.setState({ status: 'applying', progress: action === 'copy' ? null : 0 })

    let layer: ImageLayer | null = null
    if (action !== 'delete') {
      const soft = featherMask(mask, width, height)
      layer = await cutoutLayer(docId, snap, cutoutPixels(data, width, soft), soft, 'Object')
    }
    let write: RasterApply | null = null
    let method: 'lama' | 'telea' | null = null
    if (action !== 'copy') {
      const erased = await eraseMask(snap, mask, {
        quality: 'auto',
        // Object outlines leave soft edges and contact shadows behind; scale the margin with the image.
        grow: Math.max(3, Math.round(Math.hypot(width, height) * 0.004)),
        onProgress: (progress) => useSelectStore.setState({ progress })
      })
      write = await writeRaster(docId, snap, erased.pixels, [erased.region])
      method = erased.method
    }

    const target = snap.target
    useDocumentStore.getState().commit(LABELS[action], (d) => {
      const at = write ? write(d) : indexAbove(d, target)
      if (!layer) return
      d.assets[layer.assetId] = { mime: 'image/png' }
      d.pages.find((p) => p.id === target.pageId)?.layers.splice(at, 0, layer)
    })
    reset()
    if (layer) {
      useDocumentStore.getState().select([layer.id])
      useToolStore.getState().setTool('select')
    }
    if (method === 'telea') suggestQualityEraser()
  })
}

// Leaving the tool, or any change to the selected picture (edit, undo, move), ends the selection.
useToolStore.subscribe((state, previous) => {
  if (previous.tool === 'magic' && state.tool !== 'magic') clearSelection()
})
useDocumentStore.subscribe((state) => {
  const { status, target } = useSelectStore.getState()
  if (!prepared || !target || !state.doc || status === 'applying' || status === 'preparing') return
  if (rasterVersion(state.doc, target) !== prepared.version) clearSelection()
})
