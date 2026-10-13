import { Columns2, Download, ImagePlus, Trash2, Wallpaper } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Generation } from '@shared/document/model'
import ui from '../../ui/ui.module.css'
import { useAssetImage } from '../assets/asset-cache'
import { useDocumentStore } from '../document/store'
import { useModelName } from './ai-models'
import { compare } from './compare'
import { useGenerate } from './generate'
import { addAsLayer, deleteResult, exportResult, applyAsPage } from './results'
import { UsageView } from './UsageView'
import styles from './AiPanel.module.css'

function ModelName({ id }: { id: string }) {
  return <>{useModelName(id)}</>
}

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(iso).toLocaleDateString()
}

function Thumbnail({ docId, assetId }: { docId: string; assetId: string }) {
  const image = useAssetImage(docId, assetId)
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !image) return
    canvas.height = Math.round((canvas.width * image.naturalHeight) / image.naturalWidth)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  }, [image])
  return <canvas ref={ref} className={styles.thumb} width={256} height={160} />
}

function ResultCard({
  docId,
  generation,
  pageNumber
}: {
  docId: string
  generation: Generation
  pageNumber: number | null
}) {
  const latest = useGenerate((s) => s.latest === generation.id)
  return (
    <li className={styles.card} data-latest={latest} data-testid="ai-result">
      <Thumbnail docId={docId} assetId={generation.assetId} />
      <p className={styles.prompt} title={generation.revisedPrompt ?? generation.prompt}>
        {generation.prompt}
      </p>
      <p className={styles.meta}>
        <ModelName id={generation.model} /> · {ago(generation.createdAt)}
        {generation.credits ? ` · ${generation.credits} credits` : ''}
        {pageNumber ? ` · page ${pageNumber}` : ''}
      </p>
      <div className={styles.actions}>
        <button
          className={ui.iconButton}
          title="Compare with the page"
          aria-label="Compare"
          onClick={() => compare(generation.id)}
        >
          <Columns2 size={16} />
        </button>
        <button
          className={ui.iconButton}
          title="Use as page"
          aria-label="Use as page"
          onClick={() => void applyAsPage(generation)}
        >
          <Wallpaper size={16} />
        </button>
        <button
          className={ui.iconButton}
          title="Add as layer"
          aria-label="Add as layer"
          onClick={() => void addAsLayer(generation)}
        >
          <ImagePlus size={16} />
        </button>
        <button
          className={ui.iconButton}
          title="Export"
          aria-label="Export"
          onClick={() => void exportResult(generation)}
        >
          <Download size={16} />
        </button>
        <span className={styles.spacer} />
        <button
          className={ui.iconButton}
          title="Delete"
          aria-label="Delete"
          onClick={() => void deleteResult(generation)}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </li>
  )
}

/** AI tab: this project's results (newest first) and, under Usage, spending and account history. */
export function AiPanel() {
  const [view, setView] = useState<'results' | 'usage'>('results')
  const docId = useDocumentStore((s) => s.docId)
  const generations = useDocumentStore((s) => s.doc?.generations)
  const pages = useDocumentStore((s) => s.doc?.pages)
  if (!docId) return null
  const list = [...(generations ?? [])].reverse()
  const multiPage = (pages?.length ?? 0) > 1

  return (
    <div className={styles.panel}>
      <div className={styles.switch} role="tablist" aria-label="AI">
        {(['results', 'usage'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            className={styles.switchButton}
            onClick={() => setView(v)}
          >
            {v === 'results' ? 'Results' : 'Usage'}
          </button>
        ))}
      </div>
      {view === 'usage' ? (
        <UsageView />
      ) : list.length === 0 ? (
        <p className={styles.empty}>
          Describe a change in the bar under the canvas. The page with your edits is sent to CallMissed, and
          the results appear here to compare, use as the page or add as a layer.
        </p>
      ) : (
        <ul className={styles.list}>
          {list.map((g) => {
            const index = pages?.findIndex((p) => p.id === g.pageId) ?? -1
            return (
              <ResultCard
                key={g.id}
                docId={docId}
                generation={g}
                pageNumber={multiPage && index >= 0 ? index + 1 : null}
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}
