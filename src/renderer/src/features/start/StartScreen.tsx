import { FileImage, FolderOpen, History, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { RecentProject, Recoverable } from '@shared/ipc/contracts'
import { call } from '../../lib/ipc'
import { commands } from '../commands/commands'
import ui from '../../ui/ui.module.css'
import styles from './StartScreen.module.css'

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

export function StartScreen() {
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [recoverable, setRecoverable] = useState<Recoverable[]>([])

  const refresh = useCallback(() => {
    call('library:recent').then(setRecent).catch(console.error)
    call('workspace:list-recoverable').then(setRecoverable).catch(console.error)
  }, [])

  useEffect(refresh, [refresh])

  return (
    <div className={styles.screen}>
      <div className={styles.content}>
        <header className={styles.hero}>
          <img className={styles.logo} src="./icon.png" alt="" />
          <div>
            <h1 className={styles.title}>CallMissed Studio</h1>
            <p className={styles.subtitle}>Edit text and objects in images and PDFs.</p>
          </div>
        </header>

        <button
          className={styles.dropZone}
          onClick={() => void commands.openDialog()}
          data-testid="open-file"
        >
          <FolderOpen size={28} />
          <strong>Open an image, PDF or project</strong>
          <span>or drop a file anywhere in this window · PNG, JPEG, WebP, GIF, BMP, PDF, .cmsp</span>
        </button>

        {recoverable.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.heading}>
              <History size={16} /> Recover unsaved work
            </h2>
            <ul className={styles.list}>
              {recoverable.map((r) => (
                <li key={r.docId} className={styles.item}>
                  <div className={styles.itemText}>
                    <strong>{r.name}</strong>
                    <span>Last change {formatDate(r.updatedAt)}</span>
                  </div>
                  <button className={ui.primaryButton} onClick={() => void commands.recover(r.docId)}>
                    Recover
                  </button>
                  <button
                    className={ui.button}
                    onClick={() => void commands.discardRecovery(r.docId).then(refresh)}
                  >
                    Discard
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {recent.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.heading}>Recent projects</h2>
            <ul className={styles.grid}>
              {recent.map((p) => (
                <li key={p.path} className={styles.card}>
                  <button
                    className={styles.cardButton}
                    onClick={() => void commands.openPath(p.path)}
                    title={p.path}
                  >
                    {p.thumbnail ? (
                      <img className={styles.thumb} src={p.thumbnail} alt="" />
                    ) : (
                      <span className={styles.thumb}>
                        <FileImage size={28} />
                      </span>
                    )}
                    <strong className={styles.cardName}>{p.name}</strong>
                    <span className={styles.cardDate}>{formatDate(p.lastOpenedAt)}</span>
                  </button>
                  <button
                    className={`${ui.iconButton} ${styles.forget}`}
                    aria-label={`Remove ${p.name} from recent`}
                    title="Remove from recent"
                    onClick={() => void call('library:forget', { path: p.path }).then(refresh)}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
