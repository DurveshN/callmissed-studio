import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { StudioDocument } from '@shared/document/model'
import { History } from '@shared/document/history'
import { Manifest, migrateDocument, ProjectFiles, SCHEMA_VERSION } from '@shared/project/format'
import { StudioError } from '@shared/ipc/result'

export interface ProjectContents {
  manifest: Manifest
  document: StudioDocument
  history: History
  thumbnail: Uint8Array | null
  /** File name inside assets/ → bytes. */
  assets: Record<string, Uint8Array>
}

const MAX_ENTRY_BYTES = 1024 ** 3
const MAX_TOTAL_BYTES = 4 * 1024 ** 3
const ASSET_NAME = /^assets\/[0-9a-f-]{36}\.[a-z]{2,4}$/
const ALLOWED = new Set<string>([
  ProjectFiles.manifest,
  ProjectFiles.document,
  ProjectFiles.history,
  ProjectFiles.thumbnail
])

/** Serialises a project into .cmsp zip bytes. Images are stored, JSON is deflated. */
export function packProject(contents: ProjectContents): Uint8Array {
  const json = (value: unknown) => strToU8(JSON.stringify(value))
  const files: Zippable = {
    [ProjectFiles.manifest]: json(contents.manifest),
    [ProjectFiles.document]: json(contents.document),
    [ProjectFiles.history]: json(contents.history)
  }
  if (contents.thumbnail) files[ProjectFiles.thumbnail] = [contents.thumbnail, { level: 0 }]
  for (const [name, bytes] of Object.entries(contents.assets)) {
    files[`${ProjectFiles.assetsDir}/${name}`] = [bytes, { level: 0 }]
  }
  return zipSync(files, { level: 6 })
}

/** Parses and validates .cmsp bytes, rejecting unknown entries, oversized entries and newer schemas. */
export function unpackProject(bytes: Uint8Array): ProjectContents {
  let total = 0
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (!ALLOWED.has(file.name) && !ASSET_NAME.test(file.name)) return false
        total += file.originalSize
        if (file.originalSize > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) {
          throw new StudioError('INVALID_INPUT', 'Project file is too large or corrupted')
        }
        return true
      }
    })
  } catch (error) {
    if (error instanceof StudioError) throw error
    throw new StudioError('INVALID_INPUT', 'Not a valid CallMissed Studio project')
  }

  const readJson = (name: string): unknown => {
    const entry = entries[name]
    if (!entry) throw new StudioError('INVALID_INPUT', `Project is missing ${name}`)
    try {
      return JSON.parse(strFromU8(entry))
    } catch {
      throw new StudioError('INVALID_INPUT', `Project ${name} is corrupted`)
    }
  }

  const manifest = Manifest.safeParse(readJson(ProjectFiles.manifest))
  if (!manifest.success) throw new StudioError('INVALID_INPUT', 'Project manifest is invalid')
  if (manifest.data.schemaVersion > SCHEMA_VERSION) {
    throw new StudioError('INVALID_INPUT', 'This project was saved by a newer version of CallMissed Studio')
  }

  const document = StudioDocument.safeParse(
    migrateDocument(readJson(ProjectFiles.document), manifest.data.schemaVersion)
  )
  if (!document.success) throw new StudioError('INVALID_INPUT', 'Project document is invalid')

  // Undo history is a convenience; an unreadable one is dropped rather than failing the open.
  const history = entries[ProjectFiles.history] ? History.safeParse(readJson(ProjectFiles.history)) : null

  const assets: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(entries)) {
    if (ASSET_NAME.test(name)) assets[name.slice(ProjectFiles.assetsDir.length + 1)] = data
  }

  return {
    manifest: { ...manifest.data, schemaVersion: SCHEMA_VERSION },
    document: document.data,
    history: history?.success ? history.data : { undo: [], redo: [] },
    thumbnail: entries[ProjectFiles.thumbnail] ?? null,
    assets
  }
}
