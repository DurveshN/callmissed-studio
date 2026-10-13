import { Loader2, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AI_MODELS, creditsFor, MAX_IMAGES, MAX_PROMPT, type AiModelId } from '@shared/ai/models'
import { call } from '../../lib/ipc'
import ui from '../../ui/ui.module.css'
import { useSettingsUi } from '../settings/settings-ui'
import { refreshKeyStatus, useAiKey } from './ai-key'
import { cancelGeneration, generate, useGenerate } from './generate'
import styles from './PromptBar.module.css'

type Availability = Record<string, { available: boolean; message: string | null }>

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

/**
 * The prompt bar under the canvas: describe a change, and the current page (with all edits) is sent
 * to CallMissed as the reference picture. Results go to the AI tab.
 */
export function PromptBar() {
  const configured = useAiKey((s) => s.configured)
  const { model, n, running } = useGenerate()
  const [prompt, setPrompt] = useState('')
  const [availability, setAvailability] = useState<Availability>({})
  const elapsed = useElapsed(running?.startedAt ?? null)

  useEffect(() => {
    void refreshKeyStatus().catch(() => undefined)
    void call('ai:models')
      .then((models) => setAvailability(Object.fromEntries(models.map((m) => [m.id, m]))))
      .catch(() => undefined)
  }, [])

  const cost = creditsFor(model, n)
  const submit = () => {
    if (!configured) return useSettingsUi.getState().setOpen(true)
    void generate(prompt)
  }

  return (
    <form
      className={styles.bar}
      data-testid="prompt-bar"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Sparkles size={18} className={styles.icon} aria-hidden />
      <textarea
        className={styles.prompt}
        rows={1}
        maxLength={MAX_PROMPT}
        placeholder="Describe how AI should change this page… (the page with your edits is sent as the picture)"
        aria-label="AI prompt"
        value={prompt}
        disabled={running !== null}
        onChange={(e) => {
          setPrompt(e.target.value)
          // Grow with the text, up to four lines (then scroll).
          e.target.style.height = 'auto'
          e.target.style.height = `${Math.min(96, e.target.scrollHeight + 2)}px`
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <select
        className={`${ui.select} ${styles.choice}`}
        aria-label="AI model"
        value={model}
        disabled={running !== null}
        onChange={(e) => useGenerate.setState({ model: e.target.value as AiModelId })}
      >
        {AI_MODELS.map((m) => {
          const status = availability[m.id]
          return (
            <option
              key={m.id}
              value={m.id}
              disabled={status?.available === false}
              title={status?.message ?? m.note}
            >
              {m.name}
              {status?.available === false ? ' (unavailable)' : ''}
            </option>
          )
        })}
      </select>
      <select
        className={`${ui.select} ${styles.choice}`}
        aria-label="Number of images"
        value={n}
        disabled={running !== null}
        onChange={(e) => useGenerate.setState({ n: Number(e.target.value) })}
      >
        {Array.from({ length: MAX_IMAGES }, (_, i) => i + 1).map((count) => (
          <option key={count} value={count}>
            {count} {count === 1 ? 'image' : 'images'}
          </option>
        ))}
      </select>
      <span
        className={styles.cost}
        title="Charged by CallMissed per image (1 credit = ₹1)"
        data-testid="ai-cost"
      >
        {cost} credits
      </span>
      {running ? (
        <button type="button" className={ui.button} onClick={cancelGeneration}>
          <Loader2 size={14} className={styles.spin} /> {elapsed}s · Cancel <X size={14} />
        </button>
      ) : configured === false ? (
        <button type="submit" className={ui.primaryButton}>
          Add API key
        </button>
      ) : (
        <button type="submit" className={ui.primaryButton} disabled={!prompt.trim()}>
          Generate
        </button>
      )}
    </form>
  )
}
