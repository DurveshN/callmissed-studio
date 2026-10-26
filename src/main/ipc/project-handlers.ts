import { writeFile } from 'node:fs/promises'
import type { LibraryDb } from '../services/library-db'
import type { ProjectService } from '../services/project-service'
import { dialogs } from '../dialogs'
import { handle } from './router'

export function registerProjectHandlers(projects: ProjectService, library: LibraryDb): void {
  handle('file:pick-open', () => dialogs.pickOpenFile())
  handle('file:pick-image', () => dialogs.pickImage())
  handle('file:pick-pages', () => dialogs.pickPages())

  handle('workspace:open-path', ({ path }) => projects.openPath(path))
  handle('workspace:import-image', ({ docId, path }) => projects.importImage(docId, path))
  handle('workspace:import-pages', ({ docId, path }) => projects.importPages(docId, path))
  handle('workspace:autosave', async ({ docId, document, history }) => {
    await projects.autosave(docId, document, history)
  })
  handle('workspace:close', async ({ docId }) => {
    await projects.close(docId)
  })
  handle('workspace:list-recoverable', () => projects.listRecoverable())
  handle('workspace:recover', ({ docId }) => projects.recover(docId))
  handle('workspace:discard', async ({ docId }) => {
    await projects.discard(docId)
  })

  handle('asset:read', ({ docId, assetId }) => projects.readAsset(docId, assetId))
  handle('asset:write', async ({ docId, assetId, mime, bytes }) => {
    await projects.writeAsset(docId, assetId, mime, bytes)
  })

  handle('project:save', ({ docId, document, history, thumbnail, saveAs }) =>
    projects.save(docId, document, history, thumbnail, saveAs)
  )

  handle('library:recent', () =>
    library.recentProjects().map((row) => ({
      path: row.path,
      name: row.name,
      lastOpenedAt: row.lastOpenedAt,
      thumbnail: row.thumbnail
        ? `data:image/png;base64,${Buffer.from(row.thumbnail).toString('base64')}`
        : null
    }))
  )
  handle('library:forget', ({ path }) => {
    library.forgetProject(path)
  })

  handle('export:save-image', async ({ bytes, suggestedName, format }) => {
    const path = await dialogs.pickExportPath(suggestedName, format)
    if (path) await writeFile(path, bytes)
    return path
  })
}
