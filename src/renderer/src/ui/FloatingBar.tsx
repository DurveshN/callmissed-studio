import { Loader2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import ui from './ui.module.css'
import styles from './FloatingBar.module.css'

interface Props {
  testId: string
  /** Exposed as data-status (tests and error styling). */
  status: string
  text: string
  icon: ReactNode
  /** Shows a spinner instead of the icon, and the progress when known. */
  busy?: boolean
  progress?: number | null
  children?: ReactNode
  onClose?: () => void
  closeLabel?: string
}

/** Floating status/action bar at the top of the canvas (one per active tool or task). */
export function FloatingBar({
  testId,
  status,
  text,
  icon,
  busy,
  progress,
  children,
  onClose,
  closeLabel
}: Props) {
  return (
    <div className={styles.bar} role="status" data-testid={testId} data-status={status}>
      {busy ? <Loader2 size={16} className={styles.spin} /> : icon}
      <span className={styles.text}>{text}</span>
      {busy && progress !== null && progress !== undefined && (
        <span className={styles.percent}>{Math.round(progress * 100)}%</span>
      )}
      {children}
      {onClose && (
        <button className={ui.iconButton} aria-label={closeLabel ?? 'Close'} onClick={onClose}>
          <X size={16} />
        </button>
      )}
    </div>
  )
}

export { styles as floatingBarStyles }
