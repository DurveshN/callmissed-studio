import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer'
import { create } from 'zustand'
import type { Layer, Page, StudioDocument } from '@shared/document/model'
import { HISTORY_LIMIT, type History, type HistoryEntry, type JsonPatch } from '@shared/document/history'

enablePatches()

/** Edits sharing a key within this window merge into one undo step (e.g. typing in a number field). */
const COALESCE_MS = 1000

interface DocumentState {
  docId: string | null
  doc: StudioDocument | null
  projectPath: string | null
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
  /** Increments on every change; compared with savedRevision to derive "dirty". */
  revision: number
  savedRevision: number
  activePageId: string | null
  selection: string[]
  lastCommit: { key: string; at: number } | null

  load(input: {
    docId: string
    doc: StudioDocument
    history: History
    projectPath: string | null
    dirty: boolean
  }): void
  unload(): void
  /** Applies an undoable change. */
  commit(label: string, recipe: (draft: Draft<StudioDocument>) => void, coalesceKey?: string): void
  undo(): void
  redo(): void
  markSaved(projectPath: string): void
  select(ids: string[]): void
  setActivePage(pageId: string): void
}

const toJson = (patches: Patch[]): JsonPatch[] => patches as JsonPatch[]
const fromJson = (patches: JsonPatch[]): Patch[] => patches as Patch[]

export const useDocumentStore = create<DocumentState>()((set, get) => ({
  docId: null,
  doc: null,
  projectPath: null,
  undoStack: [],
  redoStack: [],
  revision: 0,
  savedRevision: 0,
  activePageId: null,
  selection: [],
  lastCommit: null,

  load: ({ docId, doc, history, projectPath, dirty }) =>
    set({
      docId,
      doc,
      projectPath,
      undoStack: history.undo,
      redoStack: history.redo,
      revision: dirty ? 1 : 0,
      savedRevision: 0,
      activePageId: doc.pages[0]?.id ?? null,
      selection: [],
      lastCommit: null
    }),

  unload: () =>
    set({
      docId: null,
      doc: null,
      projectPath: null,
      undoStack: [],
      redoStack: [],
      revision: 0,
      savedRevision: 0,
      activePageId: null,
      selection: [],
      lastCommit: null
    }),

  commit: (label, recipe, coalesceKey) => {
    const { doc, undoStack, revision, lastCommit } = get()
    if (!doc) return
    const [next, patches, inverse] = produceWithPatches(doc, recipe)
    if (patches.length === 0) return

    const now = Date.now()
    const previous = undoStack.at(-1)
    const merge =
      coalesceKey !== undefined &&
      previous !== undefined &&
      lastCommit?.key === coalesceKey &&
      now - lastCommit.at < COALESCE_MS

    const entry: HistoryEntry = merge
      ? {
          label: previous.label,
          patches: [...previous.patches, ...toJson(patches)],
          inverse: [...toJson(inverse), ...previous.inverse]
        }
      : { label, patches: toJson(patches), inverse: toJson(inverse) }

    const stack = merge ? [...undoStack.slice(0, -1), entry] : [...undoStack, entry]
    set({
      doc: next,
      undoStack: stack.slice(-HISTORY_LIMIT),
      redoStack: [],
      revision: revision + 1,
      lastCommit: coalesceKey ? { key: coalesceKey, at: now } : null
    })
  },

  undo: () => {
    const { doc, undoStack, redoStack, revision } = get()
    const entry = undoStack.at(-1)
    if (!doc || !entry) return
    set({
      doc: applyPatches(doc, fromJson(entry.inverse)),
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, entry],
      revision: revision + 1,
      lastCommit: null
    })
    pruneSelection()
  },

  redo: () => {
    const { doc, undoStack, redoStack, revision } = get()
    const entry = redoStack.at(-1)
    if (!doc || !entry) return
    set({
      doc: applyPatches(doc, fromJson(entry.patches)),
      undoStack: [...undoStack, entry],
      redoStack: redoStack.slice(0, -1),
      revision: revision + 1,
      lastCommit: null
    })
    pruneSelection()
  },

  markSaved: (projectPath) => set((s) => ({ projectPath, savedRevision: s.revision })),

  select: (ids) => set({ selection: ids }),

  setActivePage: (pageId) => set({ activePageId: pageId, selection: [] })
}))

/** Drops selected ids and the active page if an undo/redo removed them. */
function pruneSelection(): void {
  const { doc, selection, activePageId } = useDocumentStore.getState()
  if (!doc) return
  const page = doc.pages.find((p) => p.id === activePageId) ?? doc.pages[0]
  const ids = new Set(page?.layers.map((l) => l.id))
  useDocumentStore.setState({
    activePageId: page?.id ?? null,
    selection: selection.filter((id) => ids.has(id))
  })
}

// ---- selectors -------------------------------------------------------------

export const selectIsDirty = (s: DocumentState): boolean => s.revision !== s.savedRevision

export function selectActivePage(s: DocumentState): Page | null {
  return s.doc?.pages.find((p) => p.id === s.activePageId) ?? null
}

export function selectSelectedLayers(s: DocumentState): Layer[] {
  const page = selectActivePage(s)
  if (!page) return []
  return page.layers.filter((l) => s.selection.includes(l.id))
}

export function getHistory(): History {
  const { undoStack, redoStack } = useDocumentStore.getState()
  return { undo: undoStack, redo: redoStack }
}

/** Finds a layer in a draft page; throws if missing so recipes fail loudly. */
export function draftLayer(draft: Draft<StudioDocument>, pageId: string, layerId: string): Draft<Layer> {
  const layer = draft.pages.find((p) => p.id === pageId)?.layers.find((l) => l.id === layerId)
  if (!layer) throw new Error(`Layer ${layerId} not found`)
  return layer
}

export function draftPage(draft: Draft<StudioDocument>, pageId: string): Draft<Page> {
  const page = draft.pages.find((p) => p.id === pageId)
  if (!page) throw new Error(`Page ${pageId} not found`)
  return page
}
