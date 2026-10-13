import { useCallback, useState } from 'react'
import { PromptBar } from '../ai/PromptBar'
import { CanvasView } from '../canvas/CanvasView'
import { ExportDialog } from '../export/ExportDialog'
import { RightPanel } from './RightPanel'
import { TopBar } from './TopBar'
import { useShortcuts } from './useShortcuts'
import styles from './Editor.module.css'

export function EditorScreen() {
  const [exporting, setExporting] = useState(false)
  const openExport = useCallback(() => setExporting(true), [])
  useShortcuts(openExport)

  return (
    <div className={styles.editor}>
      <TopBar onExport={openExport} />
      <main className={styles.workspace}>
        <div className={styles.canvasArea}>
          <CanvasView />
        </div>
        <PromptBar />
      </main>
      <RightPanel />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  )
}
