import { randomUUID } from 'node:crypto'
import { AI_MODELS, creditsFor } from '@shared/ai/models'
import type { CallMissedClient } from '../services/callmissed-client'
import type { LibraryDb } from '../services/library-db'
import type { ProjectService } from '../services/project-service'
import type { SecretStore } from '../services/secret-store'
import { handle } from './router'

export function registerAiHandlers(
  secrets: SecretStore,
  client: CallMissedClient,
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

  handle('ai:models', async () => {
    // Availability is advisory: without the catalogue (offline), every model is offered.
    const catalogue = await client.catalogue().catch(() => [])
    return AI_MODELS.map((model) => {
      const entry = catalogue.find((c) => c.id === model.id)
      const down = entry?.status === 'maintenance'
      return {
        id: model.id,
        available: !down,
        message: down ? (entry?.statusMessage ?? 'Under maintenance') : null
      }
    })
  })

  handle('ai:generate', async ({ requestId, docId, model, prompt, n, size, reference }) => {
    const controller = new AbortController()
    running.set(requestId, controller)
    try {
      const images = await client.generate({ model, prompt, n, size, reference }, controller.signal)
      const saved = []
      for (const image of images) {
        const assetId = randomUUID()
        await projects.writeAsset(docId, assetId, image.mime, image.bytes)
        saved.push({ assetId, mime: image.mime, revisedPrompt: image.revisedPrompt })
      }
      return { images: saved, credits: creditsFor(model, images.length) }
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
