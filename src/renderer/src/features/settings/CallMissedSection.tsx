import { useEffect, useState } from 'react'
import { call } from '../../lib/ipc'
import { notify } from '../../ui/notify'
import ui from '../../ui/ui.module.css'
import { refreshKeyStatus, removeKey, saveKey, useAiKey } from '../ai/ai-key'
import { loadAiModels } from '../ai/ai-models'
import styles from './SettingsDialog.module.css'

type Check = { state: 'idle' | 'busy' } | { state: 'ok' } | { state: 'failed'; message: string }

/** CallMissed API key: set, test, remove. The key is stored encrypted by main and never shown again. */
export function CallMissedSection() {
  const { configured, hint, secureStorage } = useAiKey()
  const [draft, setDraft] = useState('')
  const [check, setCheck] = useState<Check>({ state: 'idle' })

  useEffect(
    () => void refreshKeyStatus().catch((e: unknown) => notify.error(e, 'Could not read the API key')),
    []
  )

  const test = async () => {
    setCheck({ state: 'busy' })
    try {
      await call('ai:test-key')
      setCheck({ state: 'ok' })
    } catch (error) {
      setCheck({ state: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const save = async () => {
    try {
      await saveKey(draft)
      setDraft('')
      await test()
      // A new key may see different models (plan, key restrictions): fetch its list.
      void loadAiModels()
    } catch (error) {
      notify.error(error, 'Could not save the key')
    }
  }

  return (
    <section className={styles.section} data-testid="callmissed-settings">
      <h3 className={styles.heading}>CallMissed (AI generation)</h3>
      <p className={styles.hint}>
        AI generation uses your own CallMissed API key (it needs the &quot;image&quot; permission). It is
        stored encrypted on this PC and only sent to CallMissed. Create one in the CallMissed console.
      </p>
      {configured ? (
        <div className={styles.keyRow}>
          <span>
            Key <code className={ui.mono}>{hint}</code>
          </span>
          <button className={ui.button} disabled={check.state === 'busy'} onClick={() => void test()}>
            Test
          </button>
          <button
            className={ui.button}
            onClick={() => {
              setCheck({ state: 'idle' })
              void removeKey()
                .then(() => loadAiModels())
                .catch((e: unknown) => notify.error(e, 'Could not remove the key'))
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <form
          className={styles.keyRow}
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input
            className={ui.input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="cm_…"
            aria-label="CallMissed API key"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className={ui.primaryButton} type="submit" disabled={!draft.trim() || !secureStorage}>
            Save key
          </button>
        </form>
      )}
      {!secureStorage && (
        <p className={styles.error}>
          Secure storage is unavailable on this PC, so a key cannot be saved safely.
        </p>
      )}
      {check.state === 'busy' && <p className={styles.hint}>Checking the key…</p>}
      {check.state === 'ok' && <p className={styles.success}>The key works.</p>}
      {check.state === 'failed' && <p className={styles.error}>{check.message}</p>}
    </section>
  )
}
