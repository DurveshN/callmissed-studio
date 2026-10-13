import { randomUUID } from 'node:crypto'
import { StudioError } from '@shared/ipc/result'
import type { AiCatalog } from '../services/ai-catalog'
import type { CallMissedClient } from '../services/callmissed-client'
import type { LibraryDb } from '../services/library-db'
import type { ProjectService } from '../services/project-service'
import type { SecretStore } from '../services/secret-store'
import { handle } from './router'

export function registerAiHandlers(
  secrets: SecretStore,
  client: CallMissedClient,
  catalog: AiCatalog,
  projects: ProjectService,
  library: LibraryDb
): void {
  const status = async () => {
    const hint = await secrets.hint()
    return { configured: hint !== null, hint, secureStorage: secrets.available }
  }
  /** Generations in flight, so the renderer can cancel them. */
  const running = new Map<string, AbortController>()

  handle('ai:key-status', status)
  handle('ai:set-key', async ({ key }) => {
    await secrets.setKey(key)
    return status()
  })
  handle('ai:remove-key', async () => {
    await secrets.removeKey()
    return status()
  })
  handle('ai:test-key', () => client.testKey())

  handle('ai:models', ({ refresh }) => catalog.list(refresh))

  handle('ai:generate', async ({ requestId, docId, model, prompt, n, size, reference }) => {
    const info = await catalog.find(model)
    if (!info)
      throw new StudioError('API', 'This model is not offered for image editing. Refresh the model list.')
    if (!info.available)
      throw new StudioError('API', `${info.name} is not available: ${info.note ?? 'unknown reason'}.`)
    if (reference.byteLength > info.referenceMaxBytes) {
      throw new StudioError('API', `The page picture is too large for ${info.name}.`)
    }
    const controller = new AbortController()
    running.set(requestId, controller)
    try {
      const images = await client.generate(
        { model, prompt, n, size, reference, creditsPerImage: info.credits },
        controller.signal
      )
      const saved = []
      for (const image of images) {
        const assetId = randomUUID()
        await projects.writeAsset(docId, assetId, image.mime, image.bytes)
        saved.push({ assetId, mime: image.mime, revisedPrompt: image.revisedPrompt })
      }
      return { images: saved, credits: info.credits * images.length }
    } finally {
      running.delete(requestId)
    }
  })
  handle('ai:cancel', ({ requestId }) => {
    running.get(requestId)?.abort()
  })

  handle('ai:usage', () => library.usage())
  handle('ai:history', ({ before }) => client.history(before))
  handle('ai:import', async ({ docId, url }) => {
    const { bytes, mime } = await client.download(url)
    const assetId = randomUUID()
    await projects.writeAsset(docId, assetId, mime, bytes)
    return { assetId, mime }
  })
}
