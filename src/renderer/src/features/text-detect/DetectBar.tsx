import { Loader2, ScanText, X } from 'lucide-react'
import ui from '../../ui/ui.module.css'
import { cancelDetect, convertLines } from './detect'
import { useDetectStore } from './detect-store'
import styles from './DetectBar.module.css'

/** Floating status bar over the canvas while Detect Text is active. */
export function DetectBar() {
  const { status, progress, lines, message, target } = useDetectStore()
  if (status === 'idle') return null
  const printed = lines.filter((l) => !l.handwriting)
  const handwritten = lines.filter((l) => l.handwriting)
  const busy = status === 'preparing' || status === 'detecting' || status === 'converting'
  const where = target?.kind === 'layer' ? 'in the selected image' : 'on this page'

  let text: string
  if (status === 'preparing') text = message ?? 'Preparing…'
  else if (status === 'detecting') text = message ?? `Finding text ${where}…`
  else if (status === 'converting') text = 'Converting to editable text…'
  else if (status === 'error') text = message ?? 'Text detection failed.'
  else if (lines.length === 0) text = message ?? 'No text found.'
  else {
    const found = `${lines.length} text ${lines.length === 1 ? 'line' : 'lines'} found ${where}`
    text = handwritten.length
      ? `${found} · ${handwritten.length} handwritten kept as image (click to convert anyway)`
      : `${found} — click one to edit it`
  }

  return (
    <div className={styles.bar} role="status" data-testid="detect-bar" data-status={status}>
      {busy ? <Loader2 size={16} className={styles.spin} /> : <ScanText size={16} />}
      <span className={styles.text}>{text}</span>
      {busy && <span className={styles.percent}>{Math.round(progress * 100)}%</span>}
      {status === 'ready' && printed.length > 0 && (
        <button className={ui.primaryButton} onClick={() => void convertLines(printed.map((l) => l.id))}>
          Convert all
        </button>
      )}
      <button className={ui.iconButton} aria-label="Close text detection" onClick={cancelDetect}>
        <X size={16} />
      </button>
    </div>
  )
}
