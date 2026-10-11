import { useEffect, useRef } from 'react'
import type { Page, StudioDocument } from '@shared/document/model'
import { useAssetImage } from '../assets/asset-cache'
import { usePdfPage } from '../assets/pdf'
import { useDocumentStore } from '../document/store'
import styles from './PagesPanel.module.css'

const THUMB_PX_PER_POINT = 0.25

function Thumbnail({ doc, page }: { doc: StudioDocument; page: Page }) {
  const bg = page.background
  const image = useAssetImage(doc.id, bg.kind === 'image' ? bg.assetId : null)
  const canvas = usePdfPage(
    doc.id,
    bg.kind === 'pdf' ? doc.source.assetId : null,
    bg.kind === 'pdf' ? bg.pageIndex : null,
    THUMB_PX_PER_POINT
  )
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const target = ref.current
    const source = canvas ?? image
    const ctx = target?.getContext('2d')
    if (!target || !source || !ctx) return
    ctx.clearRect(0, 0, target.width, target.height)
    ctx.drawImage(source, 0, 0, target.width, target.height)
  }, [canvas, image])

  const width = 120
  return (
    <canvas
      ref={ref}
      className={styles.thumb}
      width={width}
      height={Math.round((width * page.height) / page.width)}
    />
  )
}

/** Page list for multi-page documents (PDFs). */
export function PagesPanel() {
  const doc = useDocumentStore((s) => s.doc)
  const activePageId = useDocumentStore((s) => s.activePageId)
  const setActivePage = useDocumentStore((s) => s.setActivePage)
  if (!doc) return null

  return (
    <ol className={styles.list}>
      {doc.pages.map((page, i) => (
        <li key={page.id}>
          <button
            className={styles.page}
            data-active={page.id === activePageId}
            onClick={() => setActivePage(page.id)}
            aria-label={`Page ${i + 1}`}
          >
            <Thumbnail doc={doc} page={page} />
            <span className={styles.number}>{i + 1}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}
