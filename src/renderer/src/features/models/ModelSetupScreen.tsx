import { useState } from 'react'
import type { ModelId } from '@shared/ml/models'
import ui from '../../ui/ui.module.css'
import { ModelRow } from './ModelRow'
import { formatBytes, isBusy, modelActions, useModelsStore } from './models-store'
import styles from './Models.module.css'

/** First-run screen: choose which AI model packs to download (all pre-selected), or skip. */
export function ModelSetupScreen() {
  const statuses = useModelsStore((s) => s.statuses)
  const [selected, setSelected] = useState<Set<ModelId>>(() => new Set(statuses.map((s) => s.id)))
  const pending = statuses.filter((s) => s.state !== 'installed')
  const chosen = pending.filter((s) => selected.has(s.id))
  const busy = statuses.some(isBusy)
  const allInstalled = pending.length === 0
  const total = chosen.reduce((sum, s) => sum + s.totalBytes - s.receivedBytes, 0)

  const finish = () => void modelActions.updateSettings({ modelSetupDone: true })

  return (
    <div className={styles.setup} data-testid="model-setup">
      <div className={styles.setupCard}>
        <h1 className={styles.setupTitle}>Set up AI features</h1>
        <p className={styles.setupText}>
          CallMissed Studio detects text and objects on your computer — nothing is uploaded. These models are
          downloaded once and then work offline. You can change this later in Settings.
        </p>
        <ul className={styles.list}>
          {statuses.map((status) => (
            <ModelRow
              key={status.id}
              status={status}
              selectable={{
                checked: selected.has(status.id),
                onChange: (checked) =>
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (checked) next.add(status.id)
                    else next.delete(status.id)
                    return next
                  })
              }}
            />
          ))}
        </ul>
        <div className={styles.setupActions}>
          {allInstalled ? (
            <button className={ui.primaryButton} onClick={finish}>
              Continue
            </button>
          ) : (
            <>
              <button className={ui.button} onClick={finish}>
                {busy ? 'Continue in background' : 'Skip for now'}
              </button>
              <button
                className={ui.primaryButton}
                disabled={busy || chosen.length === 0}
                onClick={() => void modelActions.download(chosen.map((s) => s.id))}
              >
                Download {chosen.length > 0 && `(${formatBytes(total)})`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
