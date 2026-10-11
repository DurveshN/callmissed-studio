import { current, type Draft } from 'immer'
import type { Layer, StudioDocument, TextLayer } from '@shared/document/model'
import { measureTextHeight } from '../canvas/text-metrics'
import { draftLayer, draftPage, useDocumentStore } from './store'

type LayerPatch = Partial<Omit<Layer, 'id' | 'type'>> & Record<string, unknown>

function activePageId(): string | null {
  return useDocumentStore.getState().activePageId
}

/** Re-measures text height after any change that affects layout. */
function refit(layer: Draft<Layer>): void {
  if (layer.type === 'text') layer.height = measureTextHeight(layer as TextLayer)
}

/** Adds a layer on top of the active page; `alsoApply` runs in the same undo step (e.g. registering its asset). */
export function addLayer(
  layer: Layer,
  label = `Add ${layer.name.toLowerCase()}`,
  alsoApply?: (draft: Draft<StudioDocument>) => void
): void {
  const pageId = activePageId()
  if (!pageId) return
  useDocumentStore.getState().commit(label, (d) => {
    alsoApply?.(d)
    const copy = structuredClone(layer)
    refit(copy)
    draftPage(d, pageId).layers.push(copy)
  })
  useDocumentStore.getState().select([layer.id])
}

export function updateLayer(layerId: string, patch: LayerPatch, label: string, coalesceKey?: string): void {
  updateLayers([[layerId, patch]], label, coalesceKey)
}

export function updateLayers(changes: [string, LayerPatch][], label: string, coalesceKey?: string): void {
  const pageId = activePageId()
  if (!pageId || changes.length === 0) return
  useDocumentStore.getState().commit(
    label,
    (d) => {
      for (const [id, patch] of changes) {
        const layer = draftLayer(d, pageId, id)
        Object.assign(layer, patch)
        refit(layer)
      }
    },
    coalesceKey
  )
}

export function deleteLayers(ids: string[]): void {
  const pageId = activePageId()
  if (!pageId || ids.length === 0) return
  const remove = new Set(ids)
  useDocumentStore.getState().commit(ids.length > 1 ? `Delete ${ids.length} layers` : 'Delete layer', (d) => {
    const page = draftPage(d, pageId)
    page.layers = page.layers.filter((l) => !remove.has(l.id))
  })
  useDocumentStore.getState().select([])
}

export function duplicateLayers(ids: string[]): void {
  const pageId = activePageId()
  if (!pageId || ids.length === 0) return
  const created: string[] = []
  useDocumentStore.getState().commit('Duplicate', (d) => {
    const page = draftPage(d, pageId)
    for (const id of ids) {
      const index = page.layers.findIndex((l) => l.id === id)
      const source = page.layers[index]
      if (!source) continue
      const copy = {
        ...structuredClone(current(source)),
        id: crypto.randomUUID(),
        name: `${source.name} copy`
      }
      copy.x += 20
      copy.y += 20
      page.layers.push(copy)
      created.push(copy.id)
    }
  })
  useDocumentStore.getState().select(created)
}

/** Moves a layer to `index` in bottom-first order. */
export function moveLayer(layerId: string, index: number): void {
  const pageId = activePageId()
  if (!pageId) return
  useDocumentStore.getState().commit('Reorder layers', (d) => {
    const layers = draftPage(d, pageId).layers
    const from = layers.findIndex((l) => l.id === layerId)
    if (from < 0) return
    const [layer] = layers.splice(from, 1)
    if (layer) layers.splice(Math.max(0, Math.min(index, layers.length)), 0, layer)
  })
}

/** +1 brings forward, -1 sends backward; Infinity / -Infinity to front/back. */
export function shiftLayers(ids: string[], delta: number): void {
  const pageId = activePageId()
  if (!pageId || ids.length === 0) return
  useDocumentStore.getState().commit(delta > 0 ? 'Bring forward' : 'Send backward', (d) => {
    const layers = draftPage(d, pageId).layers
    const selected = new Set(ids)
    const step = Number.isFinite(delta)
    // Step moves process the leading layer first so selected layers never swap with each other;
    // to-front/back processes the trailing layer first so their relative order is preserved.
    const leadingFirst = delta > 0 === step
    const order = layers.filter((l) => selected.has(l.id))
    if (leadingFirst) order.reverse()
    for (const layer of order) {
      const from = layers.findIndex((l) => l.id === layer.id)
      const to = step ? from + Math.sign(delta) : delta > 0 ? layers.length - 1 : 0
      const target = layers[to]
      if (to < 0 || to >= layers.length || (step && target && selected.has(target.id))) continue
      layers.splice(from, 1)
      layers.splice(to, 0, layer)
    }
  })
}

export function nudgeLayers(ids: string[], dx: number, dy: number): void {
  const page = useDocumentStore.getState().doc?.pages.find((p) => p.id === activePageId())
  if (!page) return
  updateLayers(
    page.layers
      .filter((l) => ids.includes(l.id) && !l.locked)
      .map((l) => [l.id, { x: l.x + dx, y: l.y + dy }]),
    'Nudge',
    `nudge:${ids.join(',')}`
  )
}

export function renameDocument(name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  useDocumentStore.getState().commit('Rename document', (d) => {
    d.name = trimmed
  })
}
