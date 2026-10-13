import { Columns2 } from 'lucide-react'
import { Group, Image as KonvaImage, Line, Rect } from 'react-konva'
import ui from '../../ui/ui.module.css'
import { FloatingBar } from '../../ui/FloatingBar'
import { useAssetImage } from '../assets/asset-cache'
import { selectActivePage, useDocumentStore } from '../document/store'
import { closeCompare, useCompare } from './compare'
import { applyAsPage } from './results'

function useComparedGeneration() {
  const generationId = useCompare((s) => s.generationId)
  return useDocumentStore((s) => s.doc?.generations?.find((g) => g.id === generationId) ?? null)
}

/**
 * Before / after on the canvas: the AI result over the page (stretched to it), shown right of a
 * divider the user drags; left of it, the page as it is.
 */
export function CompareOverlay({ px }: { px: number }) {
  const generation = useComparedGeneration()
  const split = useCompare((s) => s.split)
  const page = useDocumentStore(selectActivePage)
  const docId = useDocumentStore((s) => s.docId)
  const image = useAssetImage(docId ?? '', generation?.assetId ?? null)
  if (!generation || !page || !image) return null
  const x = page.width * split
  const handle = 14 * px
  return (
    <Group>
      <Group clipX={x} clipY={0} clipWidth={page.width - x} clipHeight={page.height} listening={false}>
        <KonvaImage image={image} width={page.width} height={page.height} />
      </Group>
      <Line
        points={[x, 0, x, page.height]}
        stroke="#ffffff"
        strokeWidth={2 * px}
        shadowBlur={4 * px}
        listening={false}
      />
      <Rect
        name="compare-handle"
        x={x - handle}
        y={page.height / 2 - handle * 2}
        width={handle * 2}
        height={handle * 4}
        cornerRadius={handle}
        fill="#ffffff"
        stroke="#5b4cf0"
        strokeWidth={2 * px}
        draggable
        dragBoundFunc={function (pos) {
          return { x: pos.x, y: this.absolutePosition().y }
        }}
        onDragMove={(e) => {
          const left = e.target.x() + handle
          useCompare.setState({ split: Math.min(1, Math.max(0, left / page.width)) })
        }}
        onMouseEnter={(e) => {
          const container = e.target.getStage()?.container()
          if (container) container.style.cursor = 'ew-resize'
        }}
        onMouseLeave={(e) => {
          const container = e.target.getStage()?.container()
          if (container) container.style.cursor = ''
        }}
      />
    </Group>
  )
}

/** What Compare shows, and its actions. */
export function CompareBar() {
  const generation = useComparedGeneration()
  if (!generation) return null
  return (
    <FloatingBar
      testId="compare-bar"
      status="ready"
      text="Before | after: drag the divider"
      icon={<Columns2 size={16} />}
      onClose={closeCompare}
      closeLabel="Close compare"
    >
      <button className={ui.primaryButton} onClick={() => void applyAsPage(generation)}>
        Use as page
      </button>
    </FloatingBar>
  )
}
