import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ModelManifest, type ModelId } from '../../src/shared/ml/models'

/** Real model packs for tests, cached in .cache/models (git-ignored) and verified against the manifest. */
export const MODEL_CACHE = join(process.cwd(), '.cache', 'models')

export async function ensureModelPack(id: ModelId): Promise<string> {
  const manifest = ModelManifest.parse(JSON.parse(readFileSync('resources/models.manifest.json', 'utf8')))
  const pack = manifest.packs.find((p) => p.id === id)
  if (!pack) throw new Error(`Unknown pack ${id}`)
  const dir = join(MODEL_CACHE, id)
  mkdirSync(dir, { recursive: true })
  for (const file of pack.files) {
    const path = join(dir, file.name)
    const ok =
      existsSync(path) && createHash('sha256').update(readFileSync(path)).digest('hex') === file.sha256
    if (ok) continue
    const response = await fetch(file.urls[0] as string)
    if (!response.ok) throw new Error(`Downloading ${file.name} failed: HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      throw new Error(`${file.name} checksum mismatch`)
    writeFileSync(path, bytes)
  }
  return MODEL_CACHE
}
