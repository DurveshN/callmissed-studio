import { useEffect } from 'react'
import { ModelRow } from '../models/ModelRow'
import { modelActions, useModelsStore } from '../models/models-store'
import ui from '../../ui/ui.module.css'
import styles from './SettingsDialog.module.css'

export function SettingsDialog({ onClose }: { onClose(): void }) {
  const statuses = useModelsStore((s) => s.statuses)
  const settings = useModelsStore((s) => s.settings)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={ui.backdrop} onMouseDown={onClose}>
      <div
        className={`${ui.dialog} ${styles.dialog}`}
        role="dialog"
        aria-labelledby="settings-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="settings-title" className={ui.dialogTitle}>
          Settings
        </h2>

        <section className={styles.section}>
          <h3 className={styles.heading}>AI models</h3>
          <p className={styles.hint}>Models run on this computer. Downloads resume if interrupted.</p>
          <ul className={styles.list}>
            {statuses.map((status) => (
              <ModelRow key={status.id} status={status} />
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <h3 className={styles.heading}>Performance</h3>
          <label className={styles.option}>
            <input
              type="checkbox"
              checked={settings?.gpu !== 'off'}
              onChange={(e) => void modelActions.updateSettings({ gpu: e.target.checked ? 'auto' : 'off' })}
            />
            <span>
              <strong>Use GPU acceleration when available</strong>
              <span className={styles.hint}>
                Uses DirectML on supported graphics cards and falls back to the CPU automatically. Turn off if
                you see rendering glitches or driver errors.
              </span>
            </span>
          </label>
        </section>

        <div className={ui.dialogActions}>
          <button className={ui.primaryButton} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
