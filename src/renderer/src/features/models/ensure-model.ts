import type { ModelId } from '@shared/ml/models'
import { confirm } from '../../ui/confirm'
import { formatBytes, modelActions, useModelsStore } from './models-store'

/**
 * Resolves true once model `id` is installed, offering to download it first (`purpose` completes
 * "… needs the X model", e.g. "Detecting text"). `onDownload` receives download progress 0..1.
 * False if the user declines or the download fails.
 */
export async function ensureModel(
  id: ModelId,
  purpose: string,
  onDownload?: (progress: number) => void
): Promise<boolean> {
  const status = () => useModelsStore.getState().statuses.find((s) => s.id === id)
  const current = status()
  if (current?.state === 'installed') return true
  const name = current?.name ?? 'AI'
  const choice = await confirm({
    title: `Download ${name.toLowerCase()}?`,
    message: `${purpose} needs the ${name} model (about ${formatBytes(current?.totalBytes ?? 0)}). It is downloaded once and then works offline.`,
    choices: [
      { id: 'download', label: 'Download' },
      { id: 'cancel', label: 'Cancel' }
    ] as const,
    cancel: 'cancel'
  })
  if (choice === 'cancel') return false
  await modelActions.download([id])
  onDownload?.(0)
  return new Promise((resolve) => {
    const unsubscribe = useModelsStore.subscribe((state) => {
      const s = state.statuses.find((x) => x.id === id)
      if (!s) return
      onDownload?.(s.totalBytes ? s.receivedBytes / s.totalBytes : 0)
      if (s.state === 'installed' || s.state === 'error' || s.state === 'missing') {
        unsubscribe()
        resolve(s.state === 'installed')
      }
    })
  })
}
