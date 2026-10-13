import { useEffect, useState } from 'react'
import type { Response as IpcResponse } from '@shared/ipc/contracts'
import { call } from '../../lib/ipc'
import { attempt, notify } from '../../ui/notify'
import ui from '../../ui/ui.module.css'
import { selectActivePage, useDocumentStore } from '../document/store'
import { useAiKey } from './ai-key'
import { useModelName } from './ai-models'
import styles from './AiPanel.module.css'

type Usage = IpcResponse<'ai:usage'>
type HistoryItem = IpcResponse<'ai:history'>['items'][number]

function ModelName({ id }: { id: string }) {
  return <>{useModelName(id)}</>
}

/** Brings an image from the CallMissed account history into this project's results. */
async function importItem(item: HistoryItem): Promise<void> {
  await attempt(async () => {
    const { docId } = useDocumentStore.getState()
    const page = selectActivePage(useDocumentStore.getState())
    if (!docId || !page) return
    const { assetId, mime } = await call('ai:import', { docId, url: item.url })
    useDocumentStore.getState().record((d) => {
      d.assets[assetId] = { mime }
      d.generations = [
        ...(d.generations ?? []),
        {
          id: crypto.randomUUID(),
          assetId,
          prompt: item.prompt,
          model: item.model,
          size: item.size,
          revisedPrompt: item.revisedPrompt,
          credits: 0,
          pageId: page.id,
          createdAt: new Date(item.created ? item.created * 1000 : Date.now()).toISOString(),
          source: 'imported'
        }
      ]
    })
    notify.info('Imported into Results')
  }, 'Could not import the image')
}

/** What this app spent on CallMissed, and the images on the account (from any app) to import. */
export function UsageView() {
  const configured = useAiKey((s) => s.configured)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [history, setHistory] = useState<{ items: HistoryItem[]; next: string | null } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void call('ai:usage')
      .then(setUsage)
      .catch((e: unknown) => notify.error(e, 'Could not read usage'))
  }, [])

  const loadHistory = async (before: string | null) => {
    setLoading(true)
    try {
      const page = await call('ai:history', { before })
      setHistory((h) => ({
        items: [...(before ? (h?.items ?? []) : []), ...page.items],
        next: page.nextCursor
      }))
    } catch (error) {
      notify.error(error, 'Could not load the account history')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.panel} data-testid="ai-usage">
      <section className={styles.section}>
        <h3 className={styles.heading}>Spent from this app</h3>
        {usage && (
          <div className={styles.stats}>
            <span className={styles.stat}>
              <strong>{Math.round(usage.credits * 100) / 100}</strong> credits
            </span>
            <span className={styles.stat}>
              <strong>{usage.images}</strong> images
            </span>
            <span className={styles.stat}>
              <strong>{usage.generations}</strong> generations
            </span>
            <span className={styles.stat}>
              <strong>{usage.failures}</strong> failed (not charged)
            </span>
          </div>
        )}
        {usage && usage.byModel.length > 0 && (
          <ul className={styles.rows}>
            {usage.byModel.map((m) => (
              <li key={m.model}>
                <span>
                  <ModelName id={m.model} />
                </span>
                <span>
                  {m.images} images · {m.credits} credits
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.meta}>
          Credits are estimated from the CallMissed price list (1 credit = ₹1). Your balance is shown in the
          CallMissed console.
        </p>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Images on your CallMissed account</h3>
        {!configured ? (
          <p className={styles.meta}>Add your API key in Settings to see images made with it.</p>
        ) : history === null ? (
          <button className={ui.button} disabled={loading} onClick={() => void loadHistory(null)}>
            {loading ? 'Loading…' : 'Show account images'}
          </button>
        ) : (
          <>
            {history.items.length === 0 && <p className={styles.meta}>No images on this account yet.</p>}
            <ul className={styles.rows}>
              {history.items.map((item) => (
                <li key={item.id}>
                  <span title={item.revisedPrompt ?? item.prompt}>
                    {item.prompt || '(no prompt)'}
                    <br />
                    <span className={styles.meta}>
                      <ModelName id={item.model} />
                      {item.created ? ` · ${new Date(item.created * 1000).toLocaleDateString()}` : ''}
                    </span>
                  </span>
                  <button className={ui.button} onClick={() => void importItem(item)}>
                    Import
                  </button>
                </li>
              ))}
            </ul>
            {history.next && (
              <button className={ui.button} disabled={loading} onClick={() => void loadHistory(history.next)}>
                {loading ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
