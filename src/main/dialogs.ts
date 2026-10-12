import { BrowserWindow, dialog, type FileFilter } from 'electron'
import { IMAGE_EXTENSIONS, OPENABLE_EXTENSIONS } from '@shared/file-types'
import { PROJECT_EXTENSION } from '@shared/project/format'

function parent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

async function pickOne(filters: FileFilter[]): Promise<string | null> {
  const win = parent()
  const options = { properties: ['openFile' as const], filters }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

async function pickSave(defaultPath: string, filters: FileFilter[]): Promise<string | null> {
  const win = parent()
  const options = { defaultPath, filters }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

export const dialogs = {
  pickOpenFile: () =>
    pickOne([
      { name: 'Images, PDFs and projects', extensions: [...OPENABLE_EXTENSIONS] },
      { name: 'CallMissed Studio project', extensions: [PROJECT_EXTENSION] },
      { name: 'Images', extensions: [...IMAGE_EXTENSIONS] },
      { name: 'PDF', extensions: ['pdf'] }
    ]),
  pickImage: () => pickOne([{ name: 'Images', extensions: [...IMAGE_EXTENSIONS] }]),
  pickProjectSavePath: (suggestedName: string) =>
    pickSave(suggestedName, [{ name: 'CallMissed Studio project', extensions: [PROJECT_EXTENSION] }]),
  pickExportPath: (suggestedName: string, format: 'png' | 'jpeg' | 'webp' | 'pdf') => {
    const ext = format === 'jpeg' ? 'jpg' : format
    return pickSave(`${suggestedName}.${ext}`, [{ name: format.toUpperCase(), extensions: [ext] }])
  }
}
