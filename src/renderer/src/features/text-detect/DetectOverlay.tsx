import { Line } from 'react-konva'
import { convertLines } from './detect'
import { useDetectStore } from './detect-store'

/** Outlines of detected text lines on the canvas; clicking one converts it to editable text. */
export function DetectOverlay({ pageId, px }: { pageId: string; px: number }) {
  const { lines, hoverId, status, target } = useDetectStore()
  if (target?.pageId !== pageId || (status !== 'ready' && status !== 'converting')) return null
  const interactive = status === 'ready'

  return (
    <>
      {lines.map((line) => {
        const hovered = line.id === hoverId
        return (
          <Line
            key={line.id}
            name="detected-line"
            points={line.corners.flatMap((p) => [p.x, p.y])}
            closed
            stroke={line.handwriting ? '#d97706' : '#5b5ff0'}
            dash={line.handwriting ? [6 * px, 4 * px] : undefined}
            strokeWidth={(hovered ? 2.5 : 1.5) * px}
            fill={
              line.handwriting
                ? hovered
                  ? 'rgba(217, 119, 6, 0.2)'
                  : 'rgba(217, 119, 6, 0.04)'
                : hovered
                  ? 'rgba(91, 95, 240, 0.22)'
                  : 'rgba(91, 95, 240, 0.08)'
            }
            listening={interactive}
            onMouseEnter={(e) => {
              useDetectStore.setState({ hoverId: line.id })
              const container = e.target.getStage()?.container()
              if (container) container.style.cursor = 'pointer'
            }}
            onMouseLeave={(e) => {
              useDetectStore.setState({ hoverId: null })
              const container = e.target.getStage()?.container()
              if (container) container.style.cursor = ''
            }}
            onMouseDown={(e) => {
              e.cancelBubble = true
            }}
            onClick={(e) => {
              e.cancelBubble = true
              void convertLines([line.id])
            }}
          />
        )
      })}
    </>
  )
}
