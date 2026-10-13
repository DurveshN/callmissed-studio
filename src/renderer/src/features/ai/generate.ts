import { create } from 'zustand'
import { DEFAULT_AI_MODEL, sizeFor, type AiModelId } from '@shared/ai/models'
import type { Generation } from '@shared/document/model'
import { call } from '../../lib/ipc'
import { notify } from '../../ui/notify'
import { selectActivePage, useDocumentStore } from '../document/store'
import { renderActivePage } from '../export/render-page'

/** Longest side of the page picture sent as the reference (GPT image models work at ~1–1.5K). */
const REFERENCE_SIDE = 2048
/** CallMissed accepts reference images up to 10 MB; stay safely below. */
const REFERENCE_BYTES = 9.5 * 1024 * 1024

interface GenerateState {
  model: AiModelId
  n: number
  /** The running request (for Cancel), or null. */
  running: { requestId: string; startedAt: number } | null
  /** The AI tab shows this generation highlighted (set when results arrive). */
  latest: string | null
}

export const useGenerate = create<GenerateState>()(() => ({
  model: DEFAULT_AI_MODEL,
  n: 1,
  running: null,
  latest: null
}))

/** The current page as displayed (picture, edits and layers), as PNG bytes within the API limits. */
async function referencePng(): Promise<Uint8Array> {
  const page = selectActivePage(useDocumentStore.getState())
  if (!page) throw new Error('No page')
  let scale = Math.min(1, REFERENCE_SIDE / Math.max(page.width, page.height))
  for (;;) {
    const canvas = renderActivePage(scale)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the page'))), 'image/png')
    )
    if (blob.size <= REFERENCE_BYTES || scale < 0.05) return new Uint8Array(await blob.arrayBuffer())
    scale *= 0.75
  }
}

/**
 * Sends the current page and `prompt` to CallMissed and keeps the results with the project (in the
 * AI tab). Results never replace anything by themselves.
 */
export async function generate(prompt: string): Promise<void> {
  const { docId } = useDocumentStore.getState()
  const page = selectActivePage(useDocumentStore.getState())
  const { model, n, running } = useGenerate.getState()
  if (!docId || !page || running || !prompt.trim()) return
  const requestId = crypto.randomUUID()
  useGenerate.setState({ running: { requestId, startedAt: Date.now() } })
  try {
    const reference = await referencePng()
    const size = sizeFor(page.width, page.height)
    const result = await call('ai:generate', {
      requestId,
      docId,
      model,
      prompt: prompt.trim(),
      n,
      size,
      reference
    })
    // The document was closed or switched while generating: its results stay in that workspace.
    if (useDocumentStore.getState().docId !== docId) return
    const createdAt = new Date().toISOString()
    const each = result.images.length ? result.credits / result.images.length : 0
    const records: Generation[] = result.images.map((image) => ({
      id: crypto.randomUUID(),
      assetId: image.assetId,
      prompt: prompt.trim(),
      model,
      size,
      revisedPrompt: image.revisedPrompt,
      credits: each,
      pageId: page.id,
      createdAt,
      source: 'generated'
    }))
    // Not an undo step: undoing an edit must never throw away a paid result.
    useDocumentStore.getState().record((d) => {
      result.images.forEach((image) => (d.assets[image.assetId] = { mime: image.mime }))
      d.generations = [...(d.generations ?? []), ...records]
    })
    useGenerate.setState({ latest: records.at(-1)?.id ?? null })
    notify.info(
      records.length === 1
        ? 'Your AI result is ready in the AI tab.'
        : `${records.length} AI results are ready in the AI tab.`
    )
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'CANCELLED') notify.error(error, 'Generation failed')
  } finally {
    useGenerate.setState({ running: null })
  }
}

export function cancelGeneration(): void {
  const running = useGenerate.getState().running
  if (running) void call('ai:cancel', { requestId: running.requestId })
}
