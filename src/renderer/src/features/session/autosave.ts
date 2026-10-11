import { call } from '../../lib/ipc'
import { getHistory, selectIsDirty, useDocumentStore } from '../document/store'

const AUTOSAVE_DELAY_MS = 2000

let timer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<void> = Promise.resolve()
let lastSavedRevision = -1

async function writeNow(): Promise<void> {
  const { docId, doc, revision } = useDocumentStore.getState()
  if (!docId || !doc || revision === lastSavedRevision) return
  await call('workspace:autosave', { docId, document: doc, history: getHistory() })
  lastSavedRevision = revision
}

/** Writes any pending change to the crash-recovery workspace immediately. */
export function flushAutosave(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  inFlight = inFlight.then(writeNow).catch((error: unknown) => console.error('Autosave failed', error))
  return inFlight
}

/** Starts autosave + window dirty tracking; returns a stop function. */
export function startAutosave(): () => void {
  let lastDirty = false
  const unsubscribe = useDocumentStore.subscribe((state, prev) => {
    const dirty = selectIsDirty(state)
    if (dirty !== lastDirty) {
      lastDirty = dirty
      void call('window:set-dirty', { dirty }).catch(() => undefined)
    }
    if (state.docId !== prev.docId) lastSavedRevision = state.revision
    if (state.doc && state.revision !== prev.revision) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void flushAutosave(), AUTOSAVE_DELAY_MS)
    }
  })
  return () => {
    unsubscribe()
    if (timer) clearTimeout(timer)
  }
}
