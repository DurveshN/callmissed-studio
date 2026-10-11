import { beforeEach, describe, expect, it, vi } from 'vitest'

// Text measuring needs a real canvas; layout is not under test here.
vi.mock('../../src/renderer/src/features/canvas/text-metrics', () => ({
  measureTextHeight: () => 20,
  fontStyle: () => 'normal'
}))

const { useDocumentStore } = await import('../../src/renderer/src/features/document/store')
const ops = await import('../../src/renderer/src/features/document/layer-ops')
const { newShapeLayer } = await import('../../src/renderer/src/features/document/factories')
const { makeDocument } = await import('./fixtures')

const store = () => useDocumentStore.getState()
const layerNames = () => store().doc?.pages[0]?.layers.map((l) => l.name)

function rect(name: string) {
  return { ...newShapeLayer('rect', { x: 0, y: 0, width: 10, height: 10 }, 1), name }
}

beforeEach(() => {
  const doc = makeDocument()
  const page = doc.pages[0]
  if (page) page.layers = []
  store().load({ docId: doc.id, doc, history: { undo: [], redo: [] }, projectPath: null, dirty: false })
})

describe('document store', () => {
  it('undoes and redoes commits, tracking dirty state', () => {
    ops.addLayer(rect('A'))
    expect(layerNames()).toEqual(['A'])
    expect(store().revision).not.toBe(store().savedRevision)

    store().undo()
    expect(layerNames()).toEqual([])
    store().redo()
    expect(layerNames()).toEqual(['A'])

    store().markSaved('C:/p.cmsp')
    expect(store().revision).toBe(store().savedRevision)
  })

  it('coalesces rapid edits with the same key into one undo step', () => {
    ops.addLayer(rect('A'))
    const id = store().selection[0] as string
    ops.updateLayer(id, { x: 1 }, 'Move', 'x')
    ops.updateLayer(id, { x: 2 }, 'Move', 'x')
    ops.updateLayer(id, { x: 3 }, 'Move', 'x')
    expect(store().undoStack).toHaveLength(2)
    store().undo()
    expect(store().doc?.pages[0]?.layers[0]?.x).toBe(0)
  })

  it('clears redo after a new commit and prunes selection on undo', () => {
    ops.addLayer(rect('A'))
    store().undo()
    expect(store().selection).toEqual([])
    ops.addLayer(rect('B'))
    expect(store().redoStack).toEqual([])
  })

  it('ignores commits that change nothing', () => {
    store().commit('noop', () => undefined)
    expect(store().undoStack).toHaveLength(0)
  })
})

describe('layer ordering', () => {
  beforeEach(() => {
    for (const n of ['A', 'B', 'C', 'D']) ops.addLayer(rect(n))
  })
  const idOf = (name: string) => store().doc?.pages[0]?.layers.find((l) => l.name === name)?.id as string

  it('steps adjacent selected layers forward without swapping them', () => {
    ops.shiftLayers([idOf('C'), idOf('D')], 1)
    expect(layerNames()).toEqual(['A', 'B', 'C', 'D'])
    ops.shiftLayers([idOf('A'), idOf('B')], 1)
    expect(layerNames()).toEqual(['C', 'A', 'B', 'D'])
  })

  it('brings to front and sends to back preserving relative order', () => {
    ops.shiftLayers([idOf('A'), idOf('B')], Infinity)
    expect(layerNames()).toEqual(['C', 'D', 'A', 'B'])
    ops.shiftLayers([idOf('A'), idOf('B')], -Infinity)
    expect(layerNames()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('duplicates, deletes and moves layers', () => {
    ops.duplicateLayers([idOf('A')])
    expect(layerNames()).toEqual(['A', 'B', 'C', 'D', 'A copy'])
    ops.deleteLayers([idOf('B'), idOf('C')])
    expect(layerNames()).toEqual(['A', 'D', 'A copy'])
    ops.moveLayer(idOf('A copy'), 0)
    expect(layerNames()).toEqual(['A copy', 'A', 'D'])
  })
})
