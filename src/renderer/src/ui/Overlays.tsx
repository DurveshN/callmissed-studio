import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useConfirmStore } from './confirm'
import { useToastStore } from './notify'
import styles from './ui.module.css'

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <div className={styles.toaster} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast} data-kind={t.kind}>
          <span>{t.message}</span>
          <button className={styles.iconButton} onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request)
  const answer = useConfirmStore((s) => s.answer)

  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(request.cancel)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, answer])

  if (!request) return null
  return (
    <div className={styles.backdrop} onMouseDown={() => answer(request.cancel)}>
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-labelledby="confirm-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className={styles.dialogTitle}>
          {request.title}
        </h2>
        <p className={styles.dialogText}>{request.message}</p>
        <div className={styles.dialogActions}>
          {request.choices.map((c, i) => (
            <button
              key={c.id}
              className={i === 0 ? styles.primaryButton : styles.button}
              autoFocus={i === 0}
              onClick={() => answer(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
