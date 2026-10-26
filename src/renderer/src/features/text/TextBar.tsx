import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Minus, Plus } from 'lucide-react'
import { useCallback, useState, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { TextLayer } from '@shared/document/model'
import { updateLayer } from '../document/layer-ops'
import { selectActivePage, selectSelectedLayers, useDocumentStore } from '../document/store'
import { FontSelect } from '../fonts/FontSelect'
import { useToolStore } from '../tools/tool-store'
import { useViewportStore } from '../canvas/viewport-store'
import { fontSizeUnit, isBold, toggledWeight } from './text-style'
import { useDocumentColors } from '../document/document-colors'
import { ColorPicker } from '../../ui/ColorPicker'
import ui from '../../ui/ui.module.css'
import styles from './TextBar.module.css'

/** Clears the transformer's rotate handle (about 50 px above the box). */
const GAP_ABOVE = 64
const GAP_BELOW = 12
const MIN_SIZE = 1
const MAX_SIZE = 2000

/** Buttons keep the text editor focused, so styling while typing doesn't end the edit. */
const keepFocus = (e: MouseEvent) => e.preventDefault()

function SizeInput({ value, onChange }: { value: number; onChange(v: number): void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = String(Math.round(value * 10) / 10)
  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw)
    if (Number.isFinite(parsed)) onChange(parsed)
    setDraft(null)
  }
  return (
    <input
      className={styles.size}
      aria-label="Font size"
      inputMode="decimal"
      value={draft ?? shown}
      onFocus={(e) => {
        setDraft(shown)
        e.currentTarget.select()
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}

/** Font, size, colour, bold, italic and alignment for the selected text box, shown just above it. */
export function TextBar() {
  const doc = useDocumentStore((s) => s.doc)
  const page = useDocumentStore(selectActivePage)
  const selected = useDocumentStore(useShallow(selectSelectedLayers))
  const tool = useToolStore((s) => s.tool)
  const editingId = useToolStore((s) => s.editingTextId)
  const viewport = useViewportStore(useShallow((s) => ({ scale: s.scale, x: s.x, y: s.y, width: s.width })))
  // The bar's own size places it (it changes with the font name).
  const [size, setSize] = useState({ width: 0, height: 0 })
  const colors = useDocumentColors()
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const observer = new ResizeObserver(() => setSize({ width: el.offsetWidth, height: el.offsetHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const editing = page?.layers.find((l) => l.id === editingId)
  const only = selected.length === 1 ? selected[0] : undefined
  const layer: TextLayer | undefined =
    editing?.type === 'text' ? editing : tool === 'select' && only?.type === 'text' ? only : undefined

  if (!doc || !page || !layer || layer.locked) return null
  const unit = fontSizeUnit(doc, page)
  const set = (patch: Partial<TextLayer>, label: string, key: string) =>
    updateLayer(layer.id, patch, label, `${key}:${layer.id}`)
  const shownSize = layer.fontSize * unit.perUnit
  const setShownSize = (shown: number) =>
    set({ fontSize: Math.min(MAX_SIZE, Math.max(MIN_SIZE, shown)) / unit.perUnit }, 'Font size', 'size')

  // Above the text box, or below it when there is no room; kept inside the canvas.
  const above = viewport.y + layer.y * viewport.scale - size.height - GAP_ABOVE
  const below = viewport.y + (layer.y + layer.height) * viewport.scale + GAP_BELOW
  const center = viewport.x + (layer.x + layer.width / 2) * viewport.scale
  const half = size.width / 2 + 8
  const left = Math.min(Math.max(center, half), Math.max(half, viewport.width - half))

  return (
    <div
      ref={ref}
      className={styles.bar}
      role="toolbar"
      aria-label="Text style"
      data-testid="text-bar"
      style={{ top: above >= 8 ? above : below, left, visibility: size.width ? 'visible' : 'hidden' }}
    >
      <FontSelect
        className={styles.font}
        value={layer.fontFamily}
        onChange={(fontFamily) => set({ fontFamily }, 'Change font', 'font')}
      />
      <span className={styles.group}>
        <button
          className={ui.iconButton}
          aria-label="Smaller text"
          onMouseDown={keepFocus}
          onClick={() => setShownSize(Math.round(shownSize) - 1)}
        >
          <Minus size={14} />
        </button>
        <SizeInput value={shownSize} onChange={setShownSize} />
        <span className={styles.unit}>{unit.suffix}</span>
        <button
          className={ui.iconButton}
          aria-label="Larger text"
          onMouseDown={keepFocus}
          onClick={() => setShownSize(Math.round(shownSize) + 1)}
        >
          <Plus size={14} />
        </button>
      </span>
      <ColorPicker
        label="Text color"
        value={layer.color}
        suggestions={colors}
        onChange={(color) => set({ color }, 'Text color', 'color')}
      />
      <span className={styles.divider} />
      <button
        className={ui.iconButton}
        aria-label="Bold"
        aria-pressed={isBold(layer)}
        onMouseDown={keepFocus}
        onClick={() => set({ fontWeight: toggledWeight(layer) }, 'Bold', 'weight')}
      >
        <Bold size={16} />
      </button>
      <button
        className={ui.iconButton}
        aria-label="Italic"
        aria-pressed={layer.italic}
        onMouseDown={keepFocus}
        onClick={() => set({ italic: !layer.italic }, 'Italic', 'italic')}
      >
        <Italic size={16} />
      </button>
      <span className={styles.divider} />
      {(
        [
          ['left', AlignLeft],
          ['center', AlignCenter],
          ['right', AlignRight]
        ] as const
      ).map(([align, Icon]) => (
        <button
          key={align}
          className={ui.iconButton}
          aria-label={`Align ${align}`}
          aria-pressed={layer.align === align}
          onMouseDown={keepFocus}
          onClick={() => set({ align }, 'Align text', 'align')}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  )
}
