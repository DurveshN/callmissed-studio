import { Check, ChevronUp, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AiModel } from '@shared/ai/models'
import { useSettingsUi } from '../settings/settings-ui'
import { useAiKey } from './ai-key'
import { loadAiModels, useAiModels } from './ai-models'
import { useGenerate } from './generate'
import styles from './PromptBar.module.css'

const PLAN_LABEL = { free: 'Free plan', starter: 'Starter+', pro: 'Pro+', enterprise: 'Enterprise' } as const

function updated(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`
  return new Date(iso).toLocaleDateString()
}

function ModelOption({ model, selected, onPick }: { model: AiModel; selected: boolean; onPick(): void }) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        aria-disabled={!model.available}
        className={styles.option}
        disabled={!model.available}
        onClick={onPick}
        data-testid="model-option"
      >
        <span className={styles.optionHead}>
          <strong>{model.name}</strong>
          <span className={styles.optionPrice}>{model.credits} credits / image</span>
          {selected && <Check size={16} className={styles.check} />}
        </span>
        <span className={styles.optionMeta}>
          <span>{model.provider}</span>
          {model.minPlan && (
            <span className={styles.badge} data-plan={model.minPlan}>
              {PLAN_LABEL[model.minPlan]}
            </span>
          )}
          {!model.available && <span className={styles.badgeWarn}>{model.note ?? 'Unavailable'}</span>}
        </span>
        {model.description && <span className={styles.optionText}>{model.description}</span>}
      </button>
    </li>
  )
}

/** The model button and its list: the image models CallMissed offers for this key, with prices. */
export function ModelPicker({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const configured = useAiKey((s) => s.configured)
  const { list, loading } = useAiModels()
  const modelId = useGenerate((s) => s.model)
  const current = list?.models.find((m) => m.id === modelId)

  // Close when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className={styles.picker} ref={ref}>
      <button
        type="button"
        className={styles.pickerButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="AI model"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.pickerName}>
          {current?.name ?? (loading ? 'Loading models…' : 'Choose a model')}
        </span>
        <ChevronUp size={14} className={styles.chevron} data-open={open} />
      </button>
      {open && (
        <div className={styles.popover} data-testid="model-picker">
          <div className={styles.popoverHead}>
            <span>Image models for your key</span>
            <button
              type="button"
              className={styles.refresh}
              title="Fetch the models again from CallMissed"
              aria-label="Refresh models"
              disabled={loading}
              onClick={() => void loadAiModels(true)}
            >
              <RefreshCw size={14} className={loading ? styles.spin : undefined} />
            </button>
          </div>
          {!configured ? (
            <div className={styles.popoverEmpty}>
              <p>Add your CallMissed API key to see the models it can use.</p>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  setOpen(false)
                  useSettingsUi.getState().setOpen(true)
                }}
              >
                Open Settings
              </button>
            </div>
          ) : !list || list.models.length === 0 ? (
            <p className={styles.popoverEmpty}>
              {loading ? 'Loading models…' : 'No image-editing models were found.'}
            </p>
          ) : (
            <ul role="listbox" aria-label="AI models" className={styles.options}>
              {list.models.map((m) => (
                <ModelOption
                  key={m.id}
                  model={m}
                  selected={m.id === modelId}
                  onPick={() => {
                    useGenerate.setState({ model: m.id })
                    setOpen(false)
                  }}
                />
              ))}
            </ul>
          )}
          {list && (
            <p className={styles.popoverFoot}>
              From CallMissed · updated {updated(list.fetchedAt)}
              {list.keyChecked ? '' : ' · not checked against your key'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
