import { useEffect, useState } from 'react'
import { commands } from '../features/commands/commands'
import { useDocumentStore } from '../features/document/store'
import { EditorScreen } from '../features/editor/EditorScreen'
import { startAutosave } from '../features/session/autosave'
import { StartScreen } from '../features/start/StartScreen'
import { ConfirmDialog, Toaster } from '../ui/Overlays'
import { ErrorBoundary } from './ErrorBoundary'
import styles from './App.module.css'

/** Opens files dropped anywhere on the window. */
function useFileDrop(): boolean {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const overHandler = (e: DragEvent) => hasFiles(e) && e.preventDefault()
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setOver(false)
      const file = e.dataTransfer?.files[0]
      if (file) void commands.openPath(window.studio.pathForFile(file))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overHandler)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overHandler)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return over
}

export function App() {
  const hasDocument = useDocumentStore((s) => s.doc !== null)
  const dropping = useFileDrop()

  useEffect(() => startAutosave(), [])
  useEffect(() => window.studio.on('app:open-path', ({ path }) => void commands.openPath(path)), [])
  useEffect(() => window.studio.on('app:save-and-close', () => void commands.saveAndClose()), [])

  return (
    <ErrorBoundary>
      {hasDocument ? <EditorScreen /> : <StartScreen />}
      {dropping && <div className={styles.dropOverlay}>Drop to open</div>}
      <ConfirmDialog />
      <Toaster />
    </ErrorBoundary>
  )
}
