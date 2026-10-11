import { z } from 'zod'

export const PROJECT_EXTENSION = 'cmsp'
export const PROJECT_FORMAT = 'cmsp'
export const SCHEMA_VERSION = 1

/** File names inside a .cmsp zip (and inside a workspace folder). */
export const ProjectFiles = {
  manifest: 'manifest.json',
  document: 'document.json',
  history: 'history.json',
  thumbnail: 'thumbnail.png',
  assetsDir: 'assets'
} as const

export const Manifest = z.object({
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: z.number().int().positive(),
  appVersion: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type Manifest = z.infer<typeof Manifest>

type Migration = (document: Record<string, unknown>) => Record<string, unknown>

/** migrations[n] upgrades a document from schema n to n + 1. */
const migrations: Record<number, Migration> = {}

export function migrateDocument(raw: unknown, fromVersion: number): unknown {
  if (fromVersion > SCHEMA_VERSION) {
    throw new Error(`Project was saved by a newer version (schema ${fromVersion}). Please update the app.`)
  }
  let doc = raw as Record<string, unknown>
  for (let v = fromVersion; v < SCHEMA_VERSION; v++) {
    const step = migrations[v]
    if (!step) throw new Error(`No migration from schema ${v}`)
    doc = step(doc)
  }
  return doc
}

const extensionByMime: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'application/pdf': 'pdf'
}

export function assetFileName(assetId: string, mime: string): string {
  return `${assetId}.${extensionByMime[mime] ?? 'bin'}`
}
