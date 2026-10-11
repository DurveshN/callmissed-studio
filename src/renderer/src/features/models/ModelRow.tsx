import { useState } from 'react'
import { CheckCircle2, Download, FlaskConical, Loader2, Trash2, X } from 'lucide-react'
import type { ModelStatus } from '@shared/ml/models'
import { runJob } from '../ml/ml-client'
import { notify } from '../../ui/notify'
import ui from '../../ui/ui.module.css'
import { formatBytes, isBusy, modelActions } from './models-store'
import styles from './Models.module.css'

const STATE_LABEL: Record<ModelStatus['state'], string> = {
  missing: 'Not installed',
  queued: 'Waiting…',
  downloading: 'Downloading',
  verifying: 'Verifying…',
  installed: 'Installed',
  error: 'Failed'
}

interface Props {
  status: ModelStatus
  /** Setup screen: a checkbox instead of per-row download buttons. */
  selectable?: { checked: boolean; onChange(checked: boolean): void }
}

export function ModelRow({ status, selectable }: Props) {
  const [testing, setTesting] = useState(false)
  const busy = isBusy(status)
  const percent = status.totalBytes ? Math.floor((status.receivedBytes / status.totalBytes) * 100) : 0

  const test = async () => {
    setTesting(true)
    try {
      const result = await runJob('probe', { model: status.id })
      const device = result.provider === 'dml' ? 'GPU (DirectML)' : 'CPU'
      notify.info(`${status.name} works — loaded on ${device} in ${result.loadMs} ms.`)
    } catch (error) {
      notify.error(error, `${status.name} could not be loaded`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <li className={styles.row} data-testid={`model-${status.id}`} data-state={status.state}>
      {selectable && status.state !== 'installed' && (
        <input
          type="checkbox"
          className={styles.check}
          aria-label={`Download ${status.name}`}
          checked={selectable.checked}
          disabled={busy}
          onChange={(e) => selectable.onChange(e.target.checked)}
        />
      )}
      {status.state === 'installed' && <CheckCircle2 size={18} className={styles.ok} />}
      <div className={styles.info}>
        <div className={styles.title}>
          <strong>{status.name}</strong>
          {status.group === 'optional' && <span className={styles.badge}>Optional</span>}
        </div>
        <p className={styles.description}>{status.description}</p>
        <p className={styles.meta}>
          {formatBytes(status.totalBytes)} · {status.license} ·{' '}
          <span data-testid="model-state">{STATE_LABEL[status.state]}</span>
          {status.state === 'downloading' && ` ${percent}%`}
        </p>
        {busy && (
          <progress
            className={styles.progress}
            max={status.totalBytes}
            value={status.receivedBytes}
            aria-label="Download progress"
          />
        )}
        {status.error && <p className={styles.error}>{status.error}</p>}
      </div>
      {!selectable && (
        <div className={styles.actions}>
          {busy && (
            <button className={ui.button} onClick={() => void modelActions.cancel(status.id)}>
              <X size={14} /> Cancel
            </button>
          )}
          {(status.state === 'missing' || status.state === 'error') && (
            <button className={ui.button} onClick={() => void modelActions.download([status.id])}>
              <Download size={14} /> {status.state === 'error' ? 'Retry' : 'Download'}
            </button>
          )}
          {status.state === 'installed' && (
            <>
              <button className={ui.button} disabled={testing} onClick={() => void test()}>
                {testing ? <Loader2 size={14} className={styles.spin} /> : <FlaskConical size={14} />} Test
              </button>
              <button
                className={ui.iconButton}
                aria-label={`Remove ${status.name}`}
                title="Remove"
                onClick={() => void modelActions.remove(status.id)}
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      )}
    </li>
  )
}
