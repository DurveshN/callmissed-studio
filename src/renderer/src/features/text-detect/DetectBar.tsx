import { ScanText } from 'lucide-react'
import ui from '../../ui/ui.module.css'
import { FloatingBar } from '../../ui/FloatingBar'
import { cancelDetect, convertLines, liftLines } from './detect'
import { useDetectStore } from './detect-store'

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
      ? `${found} · ${handwritten.length} handwritten`
      : `${found} — click one to edit it`
  }

  return (
    <FloatingBar
      testId="detect-bar"
      status={status}
      text={text}
      icon={<ScanText size={16} />}
      busy={busy}
      progress={progress}
      onClose={cancelDetect}
      closeLabel="Close text detection"
    >
      {status === 'ready' && handwritten.length > 0 && (
        <button
          className={ui.button}
          title="Move signatures and handwriting to image layers you can move and resize (click one to make it text instead)"
          onClick={() => void liftLines(handwritten.map((l) => l.id))}
        >
          Lift handwriting
        </button>
      )}
      {status === 'ready' && printed.length > 0 && (
        <button className={ui.primaryButton} onClick={() => void convertLines(printed.map((l) => l.id))}>
          Convert all
        </button>
      )}
    </FloatingBar>
  )
}
