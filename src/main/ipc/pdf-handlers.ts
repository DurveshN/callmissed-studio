import { writeFile } from 'node:fs/promises'
import { StudioError } from '@shared/ipc/result'
import { dialogs } from '../dialogs'
import type { FontFiles } from '../services/font-files'
import { writePdf } from '../services/pdf-writer'
import type { ProjectService } from '../services/project-service'
import { handle } from './router'

export function registerPdfHandlers(projects: ProjectService, fonts: FontFiles): void {
  /** Paths the user chose in the save dialog and that have not been written yet. */
  const chosen = new Set<string>()

  handle('export:choose-pdf-path', async ({ suggestedName }) => {
    const path = await dialogs.pickExportPath(suggestedName, 'pdf')
    if (path) chosen.add(path)
    return path
  })

  handle('export:write-pdf', async ({ path, docId, plan }) => {
    // The renderer may only write where the user just chose to save.
    if (!chosen.delete(path)) throw new StudioError('INVALID_INPUT', 'Choose where to save the PDF first')
    const bytes = await writePdf(plan, {
      readAsset: (assetId) => projects.readAsset(docId, assetId),
      fonts
    })
    await writeFile(path, bytes)
  })
}
