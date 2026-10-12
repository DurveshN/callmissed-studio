import { useState } from 'react'
import { commands } from '../commands/commands'
import { selectActivePage, useDocumentStore } from '../document/store'
import type { ExportFormat } from './render-page'
import { Field } from '../../ui/fields'
import ui from '../../ui/ui.module.css'
import styles from './ExportDialog.module.css'

const SCALES = [0.5, 1, 2, 3]

export function ExportDialog({ onClose }: { onClose(): void }) {
  const page = useDocumentStore(selectActivePage)
  const [format, setFormat] = useState<ExportFormat | 'pdf'>('png')
  const [searchable, setSearchable] = useState(true)
  const [scale, setScale] = useState(1)
  const [quality, setQuality] = useState(92)
  const [busy, setBusy] = useState(false)
  if (!page) return null

  const run = async () => {
    if (format === 'pdf') {
      // The PDF export shows its own progress (and can take a while with text recognition).
      onClose()
      await commands.exportPdf(searchable)
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
              <option value="pdf">PDF (all pages, text stays text)</option>
              <option value="png">PNG (lossless, transparency)</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </Field>
          {format === 'pdf' && (
            <label className={styles.check}>
              <input type="checkbox" checked={searchable} onChange={(e) => setSearchable(e.target.checked)} />
              Make scanned pages searchable (recognizes their text)
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
          <button className={ui.primaryButton} disabled={busy} onClick={() => void run()}>
            Export
          </button>
        </div>
      </div>
    </div>
  )
}
