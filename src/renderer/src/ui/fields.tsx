import { useState, type ReactNode } from 'react'
import { ColorPicker } from './ColorPicker'
import styles from './ui.module.css'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  )
}

interface NumberFieldProps {
  label: string
  value: number
  onChange(value: number): void
  min?: number
  max?: number
  step?: number
  suffix?: string
  precision?: number
}

/** Numeric input that commits on Enter/blur and supports ↑/↓ (Shift ×10). */
export function NumberField({
  label,
  value,
  onChange,
  min = -1e6,
  max = 1e6,
  step = 1,
  suffix,
  precision = 0
}: NumberFieldProps) {
  const format = (v: number) => (precision === 0 ? String(Math.round(v)) : v.toFixed(precision))
  // Text being typed; null shows the live value (so external changes like undo appear immediately).
  const [draft, setDraft] = useState<string | null>(null)

  /** Applies typed text; returns the formatted value now in effect. */
  const commit = (raw: string): string => {
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) return format(value)
    const next = Math.min(max, Math.max(min, parsed))
    if (next !== value) onChange(next)
    return format(next)
  }

  return (
    <Field label={label}>
      <span className={styles.inputWrap}>
        <input
          className={styles.input}
          inputMode="decimal"
          value={draft ?? format(value)}
          onFocus={() => setDraft(format(value))}
          onBlur={(e) => {
            commit(e.target.value)
            setDraft(null)
          }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setDraft(commit(e.currentTarget.value))
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
              setDraft(commit(String(value + delta)))
            }
          }}
        />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </span>
    </Field>
  )
}

export function ColorField({
  label,
  value,
  onChange,
  suggestions
}: {
  label: string
  value: string
  onChange(v: string): void
  suggestions?: string[]
}) {
  return (
    <Field label={label}>
      <ColorPicker label={label} value={value} onChange={onChange} suggestions={suggestions ?? []} showHex />
    </Field>
  )
}
