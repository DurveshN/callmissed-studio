import { notify } from '../../ui/notify'
import { selectActivePage, useDocumentStore } from '../document/store'
import { runJob } from '../ml/ml-client'
import { ensureModel } from '../models/ensure-model'
import { cutoutLayer, writeRaster } from '../raster/raster-edit'
import { currentTarget, snapshot } from '../raster/raster-target'
import { runTask } from '../tasks/task'

/** Below this peak opacity the model found no subject. */
const MIN_SUBJECT = 128

/**
 * Removes the background of the selected image layer (the layer becomes transparent around its
 * subject) or of the page (the subject moves to a new layer; the page behind it becomes blank).
 * One undo step.
 */
export function removeBackground(): Promise<void> {
  return runTask('Removing the background…', async (signal, report) => {
    const state = useDocumentStore.getState()
    const page = selectActivePage(state)
    const { doc, docId } = state
    if (!page || !doc || !docId) return
    const target = currentTarget(page, state.selection)
    const ready = await ensureModel('remove-bg', 'Removing backgrounds', (p) =>
      report(p, 'Downloading the background removal model…')
    )
    if (!ready) return
    report(null, 'Removing the background…')
    const snap = await snapshot(doc, target)
    const { width, height, data } = snap.image
    const { alpha } = await runJob(
      'remove-bg',
      { width, height, pixels: new Uint8Array(data.buffer.slice(0)) },
      { signal, onProgress: (p) => report(p) }
    )
    let peak = 0
    for (const a of alpha) if (a > peak) peak = a
    if (peak < MIN_SUBJECT) {
      notify.info('No clear subject was found to keep.')
      return
    }
    const cut = new Uint8ClampedArray(data)
    for (let i = 0; i < alpha.length; i++) {
      cut[i * 4 + 3] = Math.round(((cut[i * 4 + 3] as number) * (alpha[i] as number)) / 255)
    }
    const all = [{ x: 0, y: 0, width, height }]
    if (target.kind === 'layer') {
      const write = await writeRaster(docId, snap, cut, all)
      useDocumentStore.getState().commit('Remove background', (d) => void write(d))
      return
    }
    const subject = await cutoutLayer(docId, snap, cut, all[0] as (typeof all)[number], 'Subject')
    const blank = await writeRaster(docId, snap, new Uint8ClampedArray(width * height * 4).fill(255), all)
    useDocumentStore.getState().commit('Remove background', (d) => {
      const at = blank(d)
      d.assets[subject.assetId] = { mime: 'image/png' }
      d.pages.find((p) => p.id === target.pageId)?.layers.splice(at, 0, subject)
    })
    useDocumentStore.getState().select([subject.id])
  })
}
