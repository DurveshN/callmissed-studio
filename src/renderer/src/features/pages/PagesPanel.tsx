import { ArrowDown, ArrowUp, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Page, StudioDocument } from '@shared/document/model'
import { useAssetImage } from '../assets/asset-cache'
import { usePdfPage } from '../assets/pdf'
import { useDocumentStore } from '../document/store'
import { rotatePage } from '../page-geometry/page-ops'
import { openContextMenu } from '../../ui/context-menu'
import { deletePage, movePage } from './page-ops'
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

function openPageMenu(x: number, y: number, pageId: string, index: number, count: number): void {
  const activate = () => useDocumentStore.getState().setActivePage(pageId)
  openContextMenu(x, y, [
    {
      label: 'Move up',
      icon: <ArrowUp size={16} />,
      disabled: index === 0,
      onSelect: () => movePage(pageId, index - 1)
    },
    {
      label: 'Move down',
      icon: <ArrowDown size={16} />,
      disabled: index === count - 1,
      onSelect: () => movePage(pageId, index + 1)
    },
    'separator',
    {
      label: 'Rotate left',
      icon: <RotateCcw size={16} />,
      onSelect: () => {
        activate()
        void rotatePage(false)
      }
    },
    {
      label: 'Rotate right',
      icon: <RotateCw size={16} />,
      onSelect: () => {
        activate()
        void rotatePage(true)
      }
    },
    'separator',
    {
      label: 'Delete page',
      icon: <Trash2 size={16} />,
      danger: true,
      disabled: count <= 1,
      onSelect: () => deletePage(pageId)
    }
  ])
}

/** Page list: click to show a page, drag to reorder, right-click for page actions. */
export function PagesPanel() {
  const doc = useDocumentStore((s) => s.doc)
  const activePageId = useDocumentStore((s) => s.activePageId)
  const setActivePage = useDocumentStore((s) => s.setActivePage)
  const [dragged, setDragged] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  if (!doc) return null
  const count = doc.pages.length

  return (
    <ol className={styles.list}>
      {doc.pages.map((page, i) => (
        <li
          key={page.id}
          data-testid="page-item"
          data-drop={
            dropAt === i
              ? dragged && doc.pages.findIndex((p) => p.id === dragged) < i
                ? 'after'
                : 'before'
              : undefined
          }
          className={styles.item}
          draggable
          onDragStart={(e) => {
            setDragged(page.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            if (!dragged) return
            e.preventDefault()
            setDropAt(i)
          }}
          onDragEnd={() => {
            setDragged(null)
            setDropAt(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragged) movePage(dragged, i)
            setDragged(null)
            setDropAt(null)
          }}
        >
          <button
            className={styles.page}
            data-active={page.id === activePageId}
            onClick={() => setActivePage(page.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              openPageMenu(e.clientX, e.clientY, page.id, i, count)
            }}
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
