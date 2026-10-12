import { useShallow } from 'zustand/react/shallow'
import { AlignCenter, AlignLeft, AlignRight, Crop, Italic, RotateCcw, RotateCw } from 'lucide-react'
import type { Layer, ShapeLayer, TextLayer } from '@shared/document/model'
import { deleteLayers, renameDocument, updateLayer } from '../document/layer-ops'
import { ARRANGE_ACTIONS, arrange, canArrange } from '../arrange/arrange'
import { ArrangeIcon } from '../arrange/ArrangeIcon'
import { ALL_FONTS, availableWeights, fontByFamily } from '../fonts/catalog'
import { selectActivePage, selectSelectedLayers, useDocumentStore } from '../document/store'
import { ColorField, Field, NumberField } from '../../ui/fields'
import ui from '../../ui/ui.module.css'
import { MAX_PAGE_SIDE, MIN_PAGE_SIDE, resizePage, rotatePage } from '../page-geometry/page-ops'
import { useToolStore } from '../tools/tool-store'
import { AdjustSection } from './AdjustSection'
import styles from './InspectorPanel.module.css'

const WEIGHTS = [
  [100, 'Thin'],
  [300, 'Light'],
  [400, 'Regular'],
  [500, 'Medium'],
  [600, 'Semibold'],
  [700, 'Bold'],
  [900, 'Black']
] as const

function set(layer: Layer, patch: Record<string, unknown>, label: string, key: string) {
  updateLayer(layer.id, patch, label, `${key}:${layer.id}`)
}

function GeometrySection({ layer }: { layer: Layer }) {
  const isLine = layer.type === 'shape' && layer.shape === 'line'
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Position & size</h3>
      <div className={styles.grid}>
        <NumberField label="X" value={layer.x} onChange={(x) => set(layer, { x }, 'Move', 'x')} />
        <NumberField label="Y" value={layer.y} onChange={(y) => set(layer, { y }, 'Move', 'y')} />
        <NumberField
          label={isLine ? 'Length' : 'Width'}
          value={layer.width}
          min={1}
          onChange={(width) => set(layer, { width }, 'Resize', 'w')}
        />
        {layer.type !== 'text' && !isLine && (
          <NumberField
            label="Height"
            value={layer.height}
            min={1}
            onChange={(height) => set(layer, { height }, 'Resize', 'h')}
          />
        )}
        <NumberField
          label="Rotation"
          value={layer.rotation}
          suffix="°"
          min={-360}
          max={360}
          onChange={(rotation) => set(layer, { rotation }, 'Rotate', 'rot')}
        />
        <NumberField
          label="Opacity"
          value={layer.opacity * 100}
          suffix="%"
          min={0}
          max={100}
          onChange={(v) => set(layer, { opacity: v / 100 }, 'Opacity', 'opacity')}
        />
      </div>
    </section>
  )
}

function TextSection({ layer }: { layer: TextLayer }) {
  const known = fontByFamily(layer.fontFamily)
  const weights = known ? availableWeights(known) : WEIGHTS.map(([w]) => w)
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Text</h3>
      <Field label="Content">
        <textarea
          className={ui.textarea}
          value={layer.text}
          onChange={(e) => set(layer, { text: e.target.value }, 'Edit text', 'text')}
        />
      </Field>
      <Field label="Font">
        <select
          className={ui.select}
          value={layer.fontFamily}
          onChange={(e) => set(layer, { fontFamily: e.target.value }, 'Change font', 'font')}
        >
          {!known && <option value={layer.fontFamily}>{layer.fontFamily}</option>}
          <optgroup label="Included fonts">
            {ALL_FONTS.filter((f) => f.source === 'bundled').map((f) => (
              <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
                {f.family}
              </option>
            ))}
          </optgroup>
          <optgroup label="Windows fonts">
            {ALL_FONTS.filter((f) => f.source === 'system').map((f) => (
              <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
                {f.family}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>
      <div className={styles.grid}>
        <NumberField
          label="Size"
          value={layer.fontSize}
          min={1}
          max={2000}
          onChange={(fontSize) => set(layer, { fontSize }, 'Font size', 'size')}
        />
        <Field label="Weight">
          <select
            className={ui.select}
            value={layer.fontWeight}
            onChange={(e) => set(layer, { fontWeight: Number(e.target.value) }, 'Font weight', 'weight')}
          >
            {WEIGHTS.filter(([w]) => weights.includes(w) || w === layer.fontWeight).map(([w, n]) => (
              <option key={w} value={w}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <NumberField
          label="Line height"
          value={layer.lineHeight}
          min={0.5}
          max={5}
          step={0.1}
          precision={2}
          onChange={(lineHeight) => set(layer, { lineHeight }, 'Line height', 'lh')}
        />
        <ColorField
          label="Color"
          value={layer.color}
          onChange={(color) => set(layer, { color }, 'Text color', 'color')}
        />
      </div>
      <div className={styles.row}>
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
            onClick={() => set(layer, { align }, 'Align text', 'align')}
          >
            <Icon size={16} />
          </button>
        ))}
        <span className={styles.spacer} />
        <button
          className={ui.iconButton}
          aria-label="Italic"
          aria-pressed={layer.italic}
          onClick={() => set(layer, { italic: !layer.italic }, 'Italic', 'italic')}
        >
          <Italic size={16} />
        </button>
      </div>
    </section>
  )
}

function ShapeSection({ layer }: { layer: ShapeLayer }) {
  const isLine = layer.shape === 'line'
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Appearance</h3>
      <div className={styles.grid}>
        {!isLine && (
          <Field label="Fill">
            <span className={styles.row}>
              <input
                type="checkbox"
                aria-label="Has fill"
                checked={layer.fill !== null}
                onChange={(e) => set(layer, { fill: e.target.checked ? '#5b8def' : null }, 'Fill', 'fillOn')}
              />
              {layer.fill !== null && (
                <input
                  className={ui.color}
                  type="color"
                  value={layer.fill.slice(0, 7)}
                  onChange={(e) => set(layer, { fill: e.target.value }, 'Fill color', 'fill')}
                />
              )}
            </span>
          </Field>
        )}
        <Field label="Stroke">
          <span className={styles.row}>
            {!isLine && (
              <input
                type="checkbox"
                aria-label="Has stroke"
                checked={layer.stroke !== null}
                onChange={(e) =>
                  set(layer, { stroke: e.target.checked ? '#111111' : null }, 'Stroke', 'strokeOn')
                }
              />
            )}
            {(layer.stroke !== null || isLine) && (
              <input
                className={ui.color}
                type="color"
                value={(layer.stroke ?? '#111111').slice(0, 7)}
                onChange={(e) => set(layer, { stroke: e.target.value }, 'Stroke color', 'stroke')}
              />
            )}
          </span>
        </Field>
        <NumberField
          label="Stroke width"
          value={layer.strokeWidth}
          min={0}
          max={500}
          onChange={(strokeWidth) => set(layer, { strokeWidth }, 'Stroke width', 'sw')}
        />
      </div>
    </section>
  )
}

function DocumentSection() {
  const doc = useDocumentStore((s) => s.doc)
  const page = useDocumentStore(selectActivePage)
  if (!doc || !page) return null
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Document</h3>
      <Field label="Name">
        <input
          key={doc.name}
          className={ui.input}
          defaultValue={doc.name}
          onBlur={(e) => e.target.value.trim() !== doc.name && renameDocument(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      </Field>
      <dl className={styles.facts}>
        <dt>Source</dt>
        <dd title={doc.source.fileName}>{doc.source.fileName}</dd>
        <dt>Page size</dt>
        <dd>
          {Math.round(page.width)} × {Math.round(page.height)} px
        </dd>
        <dt>Pages</dt>
        <dd>{doc.pages.length}</dd>
      </dl>
    </section>
  )
}

function ArrangeSection({ ids }: { ids: string[] }) {
  const layers = useDocumentStore((s) => selectActivePage(s)?.layers) ?? []
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Arrange</h3>
      <div className={styles.row}>
        {ARRANGE_ACTIONS.map(({ action, label, shortcut }) => (
          <button
            key={action}
            className={ui.iconButton}
            aria-label={label}
            title={`${label} (${shortcut})`}
            disabled={!canArrange(layers, ids, action)}
            onClick={() => arrange(ids, action)}
          >
            <ArrangeIcon action={action} />
          </button>
        ))}
      </div>
    </section>
  )
}

/** Page geometry: turn, crop and resize (aspect ratio kept) the page with everything on it. */
function PageSection() {
  const page = useDocumentStore(selectActivePage)
  if (!page) return null
  return (
    <section className={styles.section} data-testid="page-section">
      <h3 className={styles.heading}>Page</h3>
      <div className={styles.row}>
        <button
          className={ui.iconButton}
          aria-label="Rotate page left"
          title="Rotate page left"
          onClick={() => void rotatePage(false)}
        >
          <RotateCcw size={16} />
        </button>
        <button
          className={ui.iconButton}
          aria-label="Rotate page right"
          title="Rotate page right"
          onClick={() => void rotatePage(true)}
        >
          <RotateCw size={16} />
        </button>
        <button className={ui.button} onClick={() => useToolStore.getState().setTool('crop')}>
          <Crop size={14} /> Crop page
        </button>
      </div>
      <div className={styles.grid}>
        <NumberField
          label="Width"
          value={page.width}
          suffix="px"
          min={MIN_PAGE_SIDE}
          max={MAX_PAGE_SIDE}
          onChange={(width) => void resizePage({ width })}
        />
        <NumberField
          label="Height"
          value={page.height}
          suffix="px"
          min={MIN_PAGE_SIDE}
          max={MAX_PAGE_SIDE}
          onChange={(height) => void resizePage({ height })}
        />
      </div>
    </section>
  )
}

function PageAdjustSection() {
  const page = useDocumentStore(selectActivePage)
  if (!page) return null
  return <AdjustSection target={{ kind: 'page', pageId: page.id }} adjustments={page.adjustments} />
}

export function InspectorPanel() {
  const selected = useDocumentStore(useShallow(selectSelectedLayers))
  const pageId = useDocumentStore((s) => selectActivePage(s)?.id ?? '')
  const layer = selected.length === 1 ? selected[0] : undefined

  if (selected.length > 1) {
    return (
      <div className={styles.panel}>
        <section className={styles.section}>
          <h3 className={styles.heading}>{selected.length} layers selected</h3>
          <button className={ui.button} onClick={() => deleteLayers(selected.map((l) => l.id))}>
            Delete selected
          </button>
        </section>
        <ArrangeSection ids={selected.map((l) => l.id)} />
      </div>
    )
  }

  return (
    <div className={styles.panel} data-testid="inspector">
      {!layer && <DocumentSection />}
      {!layer && <PageSection />}
      {!layer && <PageAdjustSection />}
      {layer && <GeometrySection layer={layer} />}
      {layer && <ArrangeSection ids={[layer.id]} />}
      {layer?.type === 'text' && <TextSection layer={layer} />}
      {layer?.type === 'shape' && <ShapeSection layer={layer} />}
      {layer?.type === 'image' && (
        <section className={styles.section}>
          <h3 className={styles.heading}>Image</h3>
          <div className={styles.row}>
            <button className={ui.button} onClick={() => useToolStore.getState().setTool('crop')}>
              <Crop size={14} /> Crop image
            </button>
          </div>
        </section>
      )}
      {layer?.type === 'image' && (
        <AdjustSection
          target={{ kind: 'layer', pageId, layerId: layer.id }}
          adjustments={layer.adjustments}
        />
      )}
    </div>
  )
}
