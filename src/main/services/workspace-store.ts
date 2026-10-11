import { existsSync, rmSync } from 'node:fs'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { StudioDocument, type AssetMime } from '@shared/document/model'
import { History } from '@shared/document/history'
import { assetFileName, ProjectFiles } from '@shared/project/format'
import { StudioError } from '@shared/ipc/result'
import { writeFileAtomic } from './fs-utils'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ASSET_FILE = /^[0-9a-f-]{36}\.[a-z]{2,4}$/i
const META = 'workspace.json'

export const WorkspaceMeta = z.object({
  name: z.string(),
  projectPath: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type WorkspaceMeta = z.infer<typeof WorkspaceMeta>

export interface WorkspaceState {
  document: StudioDocument
  history: History
}

function assertId(id: string): string {
  if (!UUID.test(id)) throw new StudioError('INVALID_INPUT', 'Invalid id')
  return id
}

/**
 * One folder per open document under `root`: assets/, document.json, history.json, workspace.json.
 * It doubles as the autosave / crash-recovery store.
 */
export class WorkspaceStore {
  constructor(private readonly root: string) {}

  private dir(docId: string): string {
    return join(this.root, assertId(docId))
  }

  private assetsDir(docId: string): string {
    return join(this.dir(docId), ProjectFiles.assetsDir)
  }

  async create(docId: string, meta: WorkspaceMeta): Promise<void> {
    await mkdir(this.assetsDir(docId), { recursive: true })
    await this.writeMeta(docId, meta)
  }

  async writeMeta(docId: string, meta: WorkspaceMeta): Promise<void> {
    await writeFileAtomic(join(this.dir(docId), META), JSON.stringify(meta))
  }

  async readMeta(docId: string): Promise<WorkspaceMeta> {
    const raw: unknown = JSON.parse(await readFile(join(this.dir(docId), META), 'utf8'))
    return WorkspaceMeta.parse(raw)
  }

  async writeAsset(docId: string, assetId: string, mime: AssetMime, bytes: Uint8Array): Promise<void> {
    await writeFileAtomic(join(this.assetsDir(docId), assetFileName(assertId(assetId), mime)), bytes)
  }

  /** Writes an asset by its stored file name (used when unpacking a project). */
  async writeAssetFile(docId: string, fileName: string, bytes: Uint8Array): Promise<void> {
    if (!ASSET_FILE.test(fileName)) throw new StudioError('INVALID_INPUT', 'Invalid asset name')
    await writeFileAtomic(join(this.assetsDir(docId), fileName), bytes)
  }

  async readAsset(docId: string, assetId: string): Promise<Uint8Array> {
    const file = await this.findAsset(docId, assetId)
    if (!file) throw new StudioError('INVALID_INPUT', 'Asset not found')
    return readFile(join(this.assetsDir(docId), file))
  }

  /** Reads the given assets, keyed by their stored file name. */
  async readAssets(docId: string, assetIds: string[]): Promise<Record<string, Uint8Array>> {
    const out: Record<string, Uint8Array> = {}
    for (const id of assetIds) {
      const file = await this.findAsset(docId, id)
      if (!file) throw new StudioError('INTERNAL', `Asset ${id} is missing from the workspace`)
      out[file] = await readFile(join(this.assetsDir(docId), file))
    }
    return out
  }

  private async findAsset(docId: string, assetId: string): Promise<string | undefined> {
    const prefix = `${assertId(assetId)}.`
    return (await readdir(this.assetsDir(docId))).find((f) => f.startsWith(prefix))
  }

  async writeState(docId: string, state: WorkspaceState): Promise<void> {
    const dir = this.dir(docId)
    await writeFileAtomic(join(dir, ProjectFiles.document), JSON.stringify(state.document))
    await writeFileAtomic(join(dir, ProjectFiles.history), JSON.stringify(state.history))
  }

  async readState(docId: string): Promise<WorkspaceState> {
    const dir = this.dir(docId)
    const document = StudioDocument.parse(
      JSON.parse(await readFile(join(dir, ProjectFiles.document), 'utf8'))
    )
    let history: History = { undo: [], redo: [] }
    try {
      history = History.parse(JSON.parse(await readFile(join(dir, ProjectFiles.history), 'utf8')))
    } catch {
      // History is optional for recovery; the document itself is what matters.
    }
    return { document, history }
  }

  /** Workspaces that contain a saved document state. */
  async list(): Promise<string[]> {
    if (!existsSync(this.root)) return []
    const entries = await readdir(this.root, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && UUID.test(e.name))
      .filter((e) => existsSync(join(this.root, e.name, ProjectFiles.document)))
      .map((e) => e.name)
  }

  async remove(docId: string): Promise<void> {
    await rm(this.dir(docId), { recursive: true, force: true })
  }

  /** Synchronous variant for shutdown paths. */
  removeSync(docId: string): void {
    rmSync(this.dir(docId), { recursive: true, force: true })
  }
}
