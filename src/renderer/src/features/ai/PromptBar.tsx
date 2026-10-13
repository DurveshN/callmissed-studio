import { ArrowUp, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MAX_IMAGES, MAX_PROMPT } from '@shared/ai/models'
import { selectActivePage, useDocumentStore } from '../document/store'
import { renderActivePage } from '../export/render-page'
import { useSettingsUi } from '../settings/settings-ui'
import { refreshKeyStatus, useAiKey } from './ai-key'
import { loadAiModels, useAiModels } from './ai-models'
import { cancelGeneration, generate, useGenerate } from './generate'
import { ModelPicker } from './ModelPicker'
import styles from './PromptBar.module.css'

/** Seconds since `since` (updates every second while mounted). */
function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])
  return since === null ? 0 : Math.max(0, Math.round((now - since) / 1000))
}

/** A small picture of the current page as it will be sent (refreshed shortly after edits). */
function PageChip() {
  const revision = useDocumentStore((s) => s.revision)
  const pageId = useDocumentStore((s) => s.activePageId)
  const index = useDocumentStore((s) => s.doc?.pages.findIndex((p) => p.id === s.activePageId) ?? 0)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      const page = selectActivePage(useDocumentStore.getState())
      if (!page) return
      try {
        setSrc(renderActivePage(112 / Math.max(page.width, page.height)).toDataURL('image/png'))
      } catch {
        // The canvas is not mounted yet; the next change retries.
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [revision, pageId])
  return (
    <div
      className={styles.pageChip}
      title="This page, with your edits, is sent to CallMissed as the picture to change"
    >
      {src ? <img src={src} alt="" /> : <span className={styles.pagePlaceholder} />}
      <span>Page {index + 1}</span>
    </div>
  )
}

/**
 * The prompt composer under the canvas: describe a change; the current page (with all edits) is sent to
 * CallMissed as the picture to change, and results go to the AI tab.
 */
export function PromptBar() {
  const configured = useAiKey((s) => s.configured)
  const { model, n, running } = useGenerate()
  const credits = useAiModels((s) => s.list?.models.find((m) => m.id === model)?.credits ?? null)
  const [prompt, setPrompt] = useState('')
  const elapsed = useElapsed(running?.startedAt ?? null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void refreshKeyStatus().catch(() => undefined)
  }, [])
  // The model list belongs to the key: load it whenever a key is (or becomes) configured.
  useEffect(() => {
    if (configured) void loadAiModels()
  }, [configured])

  const busy = running !== null
  const cost = credits === null ? null : Math.round(credits * n * 100) / 100
  const submit = () => {
    if (!configured) return useSettingsUi.getState().setOpen(true)
    void generate(prompt)
  }
  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(120, el.scrollHeight)}px`
  }

  return (
    <div className={styles.dock}>
      <form
        className={styles.composer}
        data-running={busy}
        data-testid="prompt-bar"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {busy && <div className={styles.progress} aria-hidden />}
        <div className={styles.top}>
          <PageChip />
          <textarea
            ref={textarea}
            className={styles.prompt}
            rows={2}
            maxLength={MAX_PROMPT}
            placeholder="Describe how AI should change this page — e.g. “turn the background into a sunset beach”"
            aria-label="AI prompt"
            value={prompt}
            disabled={busy}
            onChange={(e) => {
              setPrompt(e.target.value)
              grow(e.target)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
        </div>
        <div className={styles.bottom}>
          <ModelPicker disabled={busy} />
          <div className={styles.count} role="radiogroup" aria-label="Number of images">
            {Array.from({ length: MAX_IMAGES }, (_, i) => i + 1).map((count) => (
              <button
                key={count}
                type="button"
                role="radio"
                aria-checked={n === count}
                aria-label={`${count} ${count === 1 ? 'image' : 'images'}`}
                className={styles.countButton}
                disabled={busy}
                onClick={() => useGenerate.setState({ n: count })}
              >
                {count}
              </button>
            ))}
          </div>
          <span className={styles.spacer} />
          {busy ? (
            <span className={styles.status}>Generating… {elapsed}s</span>
          ) : (
            <span className={styles.hint}>Enter to generate · Shift+Enter for a new line</span>
          )}
          {cost !== null && (
            <span className={styles.cost} title="Charged by CallMissed (1 credit = ₹1)" data-testid="ai-cost">
              {cost} credits
            </span>
          )}
          {busy ? (
            <button
              type="button"
              className={styles.stop}
              onClick={cancelGeneration}
              aria-label="Cancel generation"
            >
              <Square size={12} fill="currentColor" /> Cancel
            </button>
          ) : configured === false ? (
            <button type="submit" className={styles.send}>
              Add API key
            </button>
          ) : (
            <button type="submit" className={styles.send} disabled={!prompt.trim() || cost === null}>
              Generate <ArrowUp size={16} />
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
