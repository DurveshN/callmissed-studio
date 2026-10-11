import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryDb } from '../../src/main/services/library-db'
import { ProjectService } from '../../src/main/services/project-service'
import { WorkspaceStore } from '../../src/main/services/workspace-store'
import type { StudioDocument } from '../../src/shared/document/model'
import { makeDocument, PNG_1PX } from './fixtures'

let dir: string
let library: LibraryDb
let savePath: string | null

function service(): ProjectService {
  return new ProjectService({
    workspaces: new WorkspaceStore(join(dir, 'workspaces')),
    library,
    appVersion: '0.1.0',
    pickSavePath: async () => savePath
  })
}

/** Builds the document a renderer would create for an opened image source. */
function documentFor(opened: { docId: string; sourceAssetId: string }): StudioDocument {
  const doc = makeDocument({ id: opened.docId })
  return {
    ...doc,
    source: { ...doc.source, assetId: opened.sourceAssetId },
    assets: { [opened.sourceAssetId]: { mime: 'image/png' } },
    pages: doc.pages.map((p) => ({
      ...p,
      background: { kind: 'image' as const, assetId: opened.sourceAssetId }
    }))
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-proj-'))
  library = new LibraryDb(join(dir, 'library.db'))
  savePath = join(dir, 'out.cmsp')
  writeFileSync(join(dir, 'photo.png'), PNG_1PX)
})

afterEach(() => {
  library.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('ProjectService', () => {
  it('opens an image source by content type, not extension', async () => {
    writeFileSync(join(dir, 'disguised.pdf'), PNG_1PX)
    const opened = await service().openPath(join(dir, 'disguised.pdf'))
    expect(opened).toMatchObject({ kind: 'source', mime: 'image/png', fileName: 'disguised.pdf' })
  })

  it('rejects unsupported files', async () => {
    writeFileSync(join(dir, 'notes.png'), 'plain text')
    await expect(service().openPath(join(dir, 'notes.png'))).rejects.toThrow(/Unsupported file/)
  })

  it('saves a project and reopens it identically, recording it as recent', async () => {
    const projects = service()
    const opened = await projects.openPath(join(dir, 'photo.png'))
    if (opened.kind !== 'source') throw new Error('expected source')
    const document = documentFor(opened)
    const history = { undo: [{ label: 'Add text', patches: [], inverse: [] }], redo: [] }

    const path = await projects.save(opened.docId, document, history, PNG_1PX, false)
    expect(path).toBe(savePath)
    expect(library.recentProjects()[0]?.path).toBe(savePath)

    await projects.close(opened.docId)
    const reopened = await service().openPath(savePath as string)
    expect(reopened).toEqual({
      kind: 'project',
      docId: opened.docId,
      document,
      history,
      projectPath: savePath
    })
  })

  it('returns null and writes nothing when the save dialog is cancelled', async () => {
    const projects = service()
    const opened = await projects.openPath(join(dir, 'photo.png'))
    if (opened.kind !== 'source') throw new Error('expected source')
    savePath = null
    const result = await projects.save(
      opened.docId,
      documentFor(opened),
      { undo: [], redo: [] },
      PNG_1PX,
      false
    )
    expect(result).toBeNull()
  })

  it('offers crash leftovers for recovery and restores the autosaved state', async () => {
    const crashed = service()
    const opened = await crashed.openPath(join(dir, 'photo.png'))
    if (opened.kind !== 'source') throw new Error('expected source')
    const document = { ...documentFor(opened), name: 'unsaved work' }
    await crashed.autosave(opened.docId, document, { undo: [], redo: [] })
    // No close(): simulates the app dying.

    const next = service()
    const recoverable = await next.listRecoverable()
    expect(recoverable).toMatchObject([{ docId: opened.docId, name: 'unsaved work', projectPath: null }])

    const recovered = await next.recover(opened.docId)
    expect(recovered.document).toEqual(document)
    expect(await next.listRecoverable()).toEqual([])
  })

  it('removes workspaces on close and on clean shutdown', async () => {
    const projects = service()
    const a = await projects.openPath(join(dir, 'photo.png'))
    const b = await projects.openPath(join(dir, 'photo.png'))
    await projects.close(a.docId)
    expect(existsSync(join(dir, 'workspaces', a.docId))).toBe(false)
    projects.closeAllSync()
    expect(existsSync(join(dir, 'workspaces', b.docId))).toBe(false)
  })

  it('refuses access to documents that are not open', async () => {
    await expect(service().readAsset(randomUUID(), randomUUID())).rejects.toThrow(/not open/)
  })

  it('rejects asset bytes that do not match the declared type', async () => {
    const projects = service()
    const opened = await projects.openPath(join(dir, 'photo.png'))
    await expect(projects.writeAsset(opened.docId, randomUUID(), 'image/jpeg', PNG_1PX)).rejects.toThrow(
      /do not match/
    )
  })
})
