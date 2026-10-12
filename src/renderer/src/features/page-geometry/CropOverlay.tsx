import type Konva from 'konva'
import { useEffect, useRef } from 'react'
import { Group, Rect, Transformer } from 'react-konva'
import { selectActivePage, useDocumentStore } from '../document/store'
import { clampBox } from './transform'
import { useCropStore } from './crop'

/** The crop box with handles over the page or image being cropped; outside it is dimmed. */
export function CropOverlay({ px }: { px: number }) {
  const { target, box } = useCropStore()
  const page = useDocumentStore(selectActivePage)
  const rectRef = useRef<Konva.Rect>(null)
  const trRef = useRef<Konva.Transformer>(null)

  const active = box !== null
  // Attach the handles once the box is on screen.
  useEffect(() => {
    if (active && rectRef.current && trRef.current) {
      trRef.current.nodes([rectRef.current])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [active])

  if (!target || !box || !page || target.pageId !== page.id) return null
  const layer = target.kind === 'layer' ? page.layers.find((l) => l.id === target.layerId) : undefined
  const frame =
    target.kind === 'page'
      ? { x: 0, y: 0, rotation: 0, width: page.width, height: page.height }
      : layer
        ? { x: layer.x, y: layer.y, rotation: layer.rotation, width: layer.width, height: layer.height }
        : null
  if (!frame) return null

  /** Reads the box back from the node (after a drag or a handle resize) and keeps it inside. */
  const commit = () => {
    const node = rectRef.current
    if (!node) return
    const next = clampBox(
      {
        x: node.x(),
        y: node.y(),
        width: node.width() * node.scaleX(),
        height: node.height() * node.scaleY()
      },
      frame.width,
      frame.height
    )
    node.setAttrs({ ...next, scaleX: 1, scaleY: 1 })
    useCropStore.setState({ box: next })
  }

  const dim = 'rgba(0, 0, 0, 0.45)'
  const { width: W, height: H } = frame
  return (
    <Group x={frame.x} y={frame.y} rotation={frame.rotation}>
      <Rect x={0} y={0} width={W} height={box.y} fill={dim} listening={false} />
      <Rect
        x={0}
        y={box.y + box.height}
        width={W}
        height={H - box.y - box.height}
        fill={dim}
        listening={false}
      />
      <Rect x={0} y={box.y} width={box.x} height={box.height} fill={dim} listening={false} />
      <Rect
        x={box.x + box.width}
        y={box.y}
        width={W - box.x - box.width}
        height={box.height}
        fill={dim}
        listening={false}
      />
      <Rect
        ref={rectRef}
        name="crop-box"
        {...box}
        stroke="#ffffff"
        strokeWidth={1.5 * px}
        dash={[6 * px, 4 * px]}
        draggable
        // Dragging keeps the scale at 1, so the dimmed area can follow live; handle resizes apply
        // (and reset the node's scale) when released.
        onDragMove={commit}
        onTransformEnd={commit}
      />
      <Transformer
        ref={trRef}
        rotateEnabled={false}
        flipEnabled={false}
        keepRatio={false}
        ignoreStroke
        borderStroke="#ffffff"
        anchorStroke="#5b4cf0"
        anchorSize={10}
        boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
      />
    </Group>
  )
}
