import { useState } from 'react'
import { commands } from '../commands/commands'
import { selectActivePage, useDocumentStore } from '../document/store'
import { parsePageRange } from '../pages/page-range'
import type { ExportFormat } from './render-page'
import { Field } from '../../ui/fields'
import ui from '../../ui/ui.module.css'
import styles from './ExportDialog.module.css'

const SCALES = [0.5, 1, 2, 3]

export function ExportDialog({ onClose }: { onClose(): void }) {
  const page = useDocumentStore(selectActivePage)
  const [format, setFormat] = useState<ExportFormat | 'pdf'>('png')
  const [searchable, setSearchable] = useState(true)
  const [flatten, setFlatten] = useState(true)
  const fromPdf = useDocumentStore((s) => s.doc?.pages.some((p) => p.background.kind === 'pdf') ?? false)
  const pageCount = useDocumentStore((s) => s.doc?.pages.length ?? 0)
  const pageIndex = useDocumentStore((s) => s.doc?.pages.findIndex((p) => p.id === s.activePageId) ?? 0)
  const [which, setWhich] = useState<'all' | 'current' | 'range'>('all')
  const [range, setRange] = useState('')
  const [scale, setScale] = useState(1)
  const [quality, setQuality] = useState(92)
  const [busy, setBusy] = useState(false)
  if (!page) return null
  const pages =
    which === 'all' ? undefined : which === 'current' ? [pageIndex] : parsePageRange(range, pageCount)
  const invalid = format === 'pdf' && pages === null

  const run = async () => {
    if (format === 'pdf') {
      if (pages === null) return
      // The PDF export shows its own progress (and can take a while with text recognition).
      onClose()
      await commands.exportPdf(searchable, flatten, pages)
      return
    }
    setBusy(true)
    await commands.exportPage(format, scale, quality / 100)
    setBusy(false)
    onClose()
  }

  return (
    <div className={ui.backdrop} onMouseDown={onClose}>
      <div
        className={ui.dialog}
        role="dialog"
        aria-labelledby="export-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
        }}
      >
        <h2 id="export-title" className={ui.dialogTitle}>
          {format === 'pdf' ? 'Export document' : 'Export page'}
        </h2>
        <div className={styles.form}>
          <Field label="Format">
            <select
              className={ui.select}
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat | 'pdf')}
            >
              <option value="pdf">PDF (text stays text)</option>
              <option value="png">PNG (lossless, transparency)</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </Field>
          {format === 'pdf' && pageCount > 1 && (
            <Field label="Pages">
              <select
                className={ui.select}
                value={which}
                onChange={(e) => setWhich(e.target.value as typeof which)}
              >
                <option value="all">All {pageCount} pages</option>
                <option value="current">Current page ({pageIndex + 1})</option>
                <option value="range">Choose pages…</option>
              </select>
            </Field>
          )}
          {format === 'pdf' && pageCount > 1 && which === 'range' && (
            <Field label={`Page numbers (1–${pageCount})`}>
              <input
                className={ui.input}
                value={range}
                placeholder="e.g. 1-3, 5"
                aria-invalid={invalid && range.trim() !== ''}
                autoFocus
                onChange={(e) => setRange(e.target.value)}
              />
            </Field>
          )}
          {format === 'pdf' && (
            <label className={styles.check}>
              <input type="checkbox" checked={searchable} onChange={(e) => setSearchable(e.target.checked)} />
              Make scanned pages searchable (recognizes their text)
            </label>
          )}
          {format === 'pdf' && fromPdf && (
            <label
              className={styles.check}
              title="Without this, text you replaced stays in the file under the edit, where it can still be selected and searched."
            >
              <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
              Remove replaced text (edited pages become images)
            </label>
          )}
          {format !== 'pdf' && (
            <Field label="Size">
              <select className={ui.select} value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                {SCALES.map((s) => (
                  <option key={s} value={s}>
                    {s}× — {Math.round(page.width * s)} × {Math.round(page.height * s)} px
                  </option>
                ))}
              </select>
            </Field>
          )}
          {format !== 'png' && format !== 'pdf' && (
            <Field label={`Quality — ${quality}%`}>
              <input
                type="range"
                min={40}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
              />
            </Field>
          )}
        </div>
        <div className={ui.dialogActions}>
          <button className={ui.button} onClick={onClose}>
            Cancel
          </button>
          <button className={ui.primaryButton} disabled={busy || invalid} onClick={() => void run()}>
            Export
          </button>
        </div>
      </div>
    </div>
  )
}
