import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { StudioDocument } from '@shared/document/model'
import type { History } from '@shared/document/history'
import type { OpenedProject, OpenedSource, Recoverable } from '@shared/ipc/contracts'
import { PROJECT_EXTENSION, PROJECT_FORMAT, SCHEMA_VERSION } from '@shared/project/format'
import { sniffMime } from '@shared/file-types'
import { StudioError } from '@shared/ipc/result'
import { writeFileAtomic } from './fs-utils'
import type { LibraryDb } from './library-db'
import { packProject, unpackProject } from './project-file'
import type { WorkspaceStore } from './workspace-store'

const MAX_SOURCE_BYTES = 1024 ** 3

/** A file copied into a document's workspace as an asset. */
interface Imported {
  assetId: string
  mime: OpenedSource['mime']
  fileName: string
}

export interface ProjectServiceDeps {
  workspaces: WorkspaceStore
  library: LibraryDb
  appVersion: string
  /** Asks the user where to save; resolves null when cancelled. */
  pickSavePath: (suggestedName: string) => Promise<string | null>
}

/** Opens sources and projects into workspaces, autosaves, saves .cmsp files, tracks open documents. */
export class ProjectService {
  private readonly open = new Set<string>()

  constructor(private readonly deps: ProjectServiceDeps) {}

  get openDocIds(): string[] {
    return [...this.open]
  }

  async openPath(path: string): Promise<OpenedProject | OpenedSource> {
    const ext = extname(path).slice(1).toLowerCase()
    return ext === PROJECT_EXTENSION ? this.openProject(path) : this.openSource(path)
  }

  private async readLimited(path: string): Promise<Uint8Array> {
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      throw new StudioError('INVALID_INPUT', 'File not found')
    }
    if (size > MAX_SOURCE_BYTES) throw new StudioError('INVALID_INPUT', 'File is larger than 1 GB')
    return readFile(path)
  }

  private async openSource(path: string): Promise<OpenedSource> {
    const bytes = await this.readLimited(path)
    const mime = sniffMime(bytes)
    if (!mime)
      throw new StudioError('INVALID_INPUT', 'Unsupported file. Open a PNG, JPEG, WebP, GIF, BMP or PDF.')

    const docId = randomUUID()
    const sourceAssetId = randomUUID()
    const now = new Date().toISOString()
    const fileName = basename(path)
    await this.deps.workspaces.create(docId, {
      name: fileName.replace(/\.[^.]+$/, ''),
      projectPath: null,
      createdAt: now,
      updatedAt: now
    })
    await this.deps.workspaces.writeAsset(docId, sourceAssetId, mime, bytes)
    this.open.add(docId)
    return { kind: 'source', docId, sourceAssetId, mime, fileName }
  }

  private async openProject(path: string): Promise<OpenedProject> {
    const contents = unpackProject(await this.readLimited(path))
    const docId = contents.document.id
    if (this.open.has(docId)) throw new StudioError('INVALID_INPUT', 'This project is already open')

    // A leftover workspace for the same document is superseded by the file the user chose.
    await this.deps.workspaces.remove(docId)
    await this.deps.workspaces.create(docId, {
      name: contents.document.name,
      projectPath: path,
      createdAt: contents.manifest.createdAt,
      updatedAt: contents.manifest.updatedAt
    })
    for (const [fileName, bytes] of Object.entries(contents.assets)) {
      await this.deps.workspaces.writeAssetFile(docId, fileName, bytes)
    }
    await this.deps.workspaces.writeState(docId, { document: contents.document, history: contents.history })
    this.deps.library.touchProject(path, contents.document.name, contents.thumbnail)
    this.open.add(docId)
    return {
      kind: 'project',
      docId,
      document: contents.document,
      history: contents.history,
      projectPath: path
    }
  }

  async autosave(docId: string, document: StudioDocument, history: History): Promise<void> {
    this.assertOpen(docId)
    await this.deps.workspaces.writeState(docId, { document, history })
    const meta = await this.deps.workspaces.readMeta(docId)
    await this.deps.workspaces.writeMeta(docId, {
      ...meta,
      name: document.name,
      updatedAt: new Date().toISOString()
    })
  }

  /** Writes the .cmsp; returns the path, or null if the user cancelled the dialog. */
  async save(
    docId: string,
    document: StudioDocument,
    history: History,
    thumbnail: Uint8Array,
    saveAs: boolean
  ): Promise<string | null> {
    this.assertOpen(docId)
    const meta = await this.deps.workspaces.readMeta(docId)
    let path = saveAs ? null : meta.projectPath
    if (!path) {
      path = await this.deps.pickSavePath(`${document.name}.${PROJECT_EXTENSION}`)
      if (!path) return null
      if (extname(path).toLowerCase() !== `.${PROJECT_EXTENSION}`) path = `${path}.${PROJECT_EXTENSION}`
    }

    const now = new Date().toISOString()
    // Only assets the document still references are written, so deleted layers don't bloat the file.
    const assets = await this.deps.workspaces.readAssets(docId, Object.keys(document.assets))
    const bytes = packProject({
      manifest: {
        format: PROJECT_FORMAT,
        schemaVersion: SCHEMA_VERSION,
        appVersion: this.deps.appVersion,
        createdAt: meta.createdAt,
        updatedAt: now
      },
      document,
      history,
      thumbnail,
      assets
    })
    await writeFileAtomic(path, bytes)
    await this.deps.workspaces.writeState(docId, { document, history })
    await this.deps.workspaces.writeMeta(docId, {
      ...meta,
      name: document.name,
      projectPath: path,
      updatedAt: now
    })
    this.deps.library.touchProject(path, document.name, thumbnail)
    return path
  }

  async close(docId: string): Promise<void> {
    this.open.delete(docId)
    await this.deps.workspaces.remove(docId)
  }

  /**
   * The renderer reloaded or crashed: forget which documents are open but keep their workspaces,
   * so the reloaded UI offers them for recovery.
   */
  releaseAll(): void {
    this.open.clear()
  }

  /** Called on clean shutdown: open workspaces are no longer needed. */
  closeAllSync(): void {
    for (const docId of this.open) this.deps.workspaces.removeSync(docId)
    this.open.clear()
  }

  /** Workspaces left behind by a crash (not open in this session). */
  async listRecoverable(): Promise<Recoverable[]> {
    const out: Recoverable[] = []
    for (const docId of await this.deps.workspaces.list()) {
      if (this.open.has(docId)) continue
      try {
        const meta = await this.deps.workspaces.readMeta(docId)
        out.push({ docId, name: meta.name, updatedAt: meta.updatedAt, projectPath: meta.projectPath })
      } catch {
        // Unreadable leftovers are skipped; discard() still removes them.
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async recover(docId: string): Promise<OpenedProject> {
    const [state, meta] = await Promise.all([
      this.deps.workspaces.readState(docId),
      this.deps.workspaces.readMeta(docId)
    ])
    this.open.add(docId)
    return {
      kind: 'project',
      docId,
      document: state.document,
      history: state.history,
      projectPath: meta.projectPath
    }
  }

  async discard(docId: string): Promise<void> {
    if (this.open.has(docId)) throw new StudioError('INVALID_INPUT', 'Cannot discard an open document')
    await this.deps.workspaces.remove(docId)
  }

  importImage(docId: string, path: string): Promise<Imported> {
    return this.importFile(docId, path, false)
  }

  /** A PDF or image whose pages are added to the document. */
  importPages(docId: string, path: string): Promise<Imported> {
    return this.importFile(docId, path, true)
  }

  private async importFile(docId: string, path: string, allowPdf: boolean): Promise<Imported> {
    this.assertOpen(docId)
    const bytes = await this.readLimited(path)
    const mime = sniffMime(bytes)
    if (!mime || (mime === 'application/pdf' && !allowPdf)) {
      const kinds = 'a PNG, JPEG, WebP, GIF or BMP image'
      throw new StudioError('INVALID_INPUT', `Choose ${allowPdf ? `a PDF or ${kinds}` : kinds}`)
    }
    const assetId = randomUUID()
    await this.deps.workspaces.writeAsset(docId, assetId, mime, bytes)
    return { assetId, mime, fileName: basename(path) }
  }

  async readAsset(docId: string, assetId: string): Promise<Uint8Array> {
    this.assertOpen(docId)
    return this.deps.workspaces.readAsset(docId, assetId)
  }

  async writeAsset(
    docId: string,
    assetId: string,
    mime: OpenedSource['mime'],
    bytes: Uint8Array
  ): Promise<void> {
    this.assertOpen(docId)
    if (sniffMime(bytes) !== mime)
      throw new StudioError('INVALID_INPUT', 'Asset bytes do not match their type')
    await this.deps.workspaces.writeAsset(docId, assetId, mime, bytes)
  }

  private assertOpen(docId: string): void {
    if (!this.open.has(docId)) throw new StudioError('INVALID_INPUT', 'Document is not open')
  }
}
