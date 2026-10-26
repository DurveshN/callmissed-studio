import { Pipette } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from './color'
import styles from './ColorPicker.module.css'

const PRESETS = [
  '#000000',
  '#545454',
  '#a6a6a6',
  '#ffffff',
  '#e5484d',
  '#f76b15',
  '#ffc53d',
  '#30a46c',
  '#12a594',
  '#0090ff',
  '#5b4cf0',
  '#d6409f'
]
const MARGIN = 8

/** Chromium's screen colour picker (not yet in TypeScript's DOM types). */
interface EyeDropperApi {
  open(): Promise<{ sRGBHex: string }>
}
const eyeDropper = () => (window as unknown as { EyeDropper?: new () => EyeDropperApi }).EyeDropper

interface Props {
  value: string
  onChange(hex: string): void
  /** Accessible name of the swatch button (and the popover). */
  label: string
  /** Colours already used in the document, offered as swatches. */
  suggestions?: string[]
  /** Also show the hex code next to the swatch. */
  showHex?: boolean
}

/**
 * A swatch that opens an in-app colour picker: saturation/value square, hue, hex code, preset and
 * document colours, and an eyedropper that picks any colour on screen (the page, a picture…).
 * Changes apply live; mouse presses inside keep the text editor focused.
 */
export function ColorPicker({ value, onChange, label, suggestions = [], showHex = false }: Props) {
  const [open, setOpen] = useState(false)
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null)
  const current = (normalizeHex(value) ?? '#000000').toLowerCase()

  return (
    <>
      <button
        ref={setTrigger}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={open}
        title={label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.swatch} style={{ background: current }} />
        {showHex && <span className={styles.hex}>{current.toUpperCase()}</span>}
      </button>
      {open &&
        createPortal(
          <Popover
            anchor={trigger}
            value={current}
            label={label}
            suggestions={suggestions}
            onChange={onChange}
            onClose={() => setOpen(false)}
          />,
          document.body
        )}
    </>
  )
}

function Popover({
  anchor,
  value,
  label,
  suggestions,
  onChange,
  onClose
}: {
  anchor: HTMLElement | null
  value: string
  label: string
  suggestions: string[]
  onChange(hex: string): void
  onClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const square = useRef<HTMLDivElement>(null)
  // Kept separately so the hue survives greys and black (where the hex code loses it).
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value))
  const [shown, setShown] = useState(value)
  const [draft, setDraft] = useState<string | null>(null)
  const [position, setPosition] = useState({ left: -9999, top: -9999 })
  if (value !== shown) {
    // Changed elsewhere (undo, the other picker): follow it.
    setShown(value)
    if (value !== hsvToHex(hsv)) setHsv(hexToHsv(value))
  }

  const apply = (next: Hsv) => {
    setHsv(next)
    const hex = hsvToHex(next)
    setShown(hex)
    onChange(hex)
  }
  const applyHex = (text: string) => {
    const hex = normalizeHex(text)
    if (!hex) return
    setHsv(hexToHsv(hex))
    setShown(hex)
    onChange(hex)
  }

  // Below the swatch, or above it when there is no room; kept inside the window.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchor) return
    const a = anchor.getBoundingClientRect()
    const { width, height } = el.getBoundingClientRect()
    const below = a.bottom + MARGIN
    setPosition({
      left: Math.max(MARGIN, Math.min(a.left, window.innerWidth - width - MARGIN)),
      top: below + height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, a.top - height - MARGIN)
    })
  }, [anchor])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !anchor?.contains(target)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onClose)
    }
  }, [anchor, onClose])

  const pickInSquare = (e: PointerEvent) => {
    const box = square.current?.getBoundingClientRect()
    if (!box) return
    const s = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    const v = 1 - Math.min(1, Math.max(0, (e.clientY - box.top) / box.height))
    apply({ ...hsv, s, v })
  }

  const pickFromScreen = async () => {
    const EyeDropper = eyeDropper()
    if (!EyeDropper) return
    try {
      applyHex((await new EyeDropper().open()).sRGBHex)
    } catch {
      // Cancelled with Escape.
    }
  }

  const documentColors = [...new Set(suggestions.map(normalizeHex).filter((c): c is string => c !== null))]
    .filter((c) => !PRESETS.includes(c))
    .slice(0, 12)

  return (
    <div
      ref={ref}
      className={styles.popover}
      role="dialog"
      aria-label={label}
      data-testid="color-picker"
      style={position}
      onMouseDown={(e) => {
        // Keep focus where it was (e.g. text being typed), except for the hex and hue inputs.
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
    >
      <div
        ref={square}
        className={styles.square}
        style={{ background: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pickInSquare(e)
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && pickInSquare(e)}
      >
        <span
          className={styles.marker}
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: shown }}
        />
      </div>
      <input
        className={styles.hue}
        type="range"
        min={0}
        max={359}
        aria-label="Hue"
        value={Math.round(hsv.h)}
        onChange={(e) => apply({ ...hsv, h: Number(e.target.value) })}
      />
      <div className={styles.row}>
        <span className={styles.preview} style={{ background: shown }} />
        <input
          className={styles.hexInput}
          aria-label="Hex color"
          spellCheck={false}
          value={draft ?? shown.toUpperCase()}
          onFocus={(e) => {
            setDraft(shown.toUpperCase())
            e.currentTarget.select()
          }}
          onChange={(e) => {
            setDraft(e.target.value)
            if (normalizeHex(e.target.value) && e.target.value.replace('#', '').length >= 6)
              applyHex(e.target.value)
          }}
          onBlur={(e) => {
            applyHex(e.target.value)
            setDraft(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        {eyeDropper() && (
          <button
            type="button"
            className={styles.eyedropper}
            aria-label="Pick a color from the screen"
            title="Pick a color from the screen"
            onClick={() => void pickFromScreen()}
          >
            <Pipette size={16} />
          </button>
        )}
      </div>
      <div className={styles.swatches}>
        {PRESETS.map((c) => (
          <Swatch key={c} color={c} selected={c === shown} onPick={applyHex} />
        ))}
      </div>
      {documentColors.length > 0 && (
        <>
          <p className={styles.heading}>In this document</p>
          <div className={styles.swatches}>
            {documentColors.map((c) => (
              <Swatch key={c} color={c} selected={c === shown} onPick={applyHex} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Swatch({ color, selected, onPick }: { color: string; selected: boolean; onPick(c: string): void }) {
  return (
    <button
      type="button"
      className={styles.option}
      aria-label={color.toUpperCase()}
      aria-pressed={selected}
      style={{ background: color }}
      onClick={() => onPick(color)}
    />
  )
}
