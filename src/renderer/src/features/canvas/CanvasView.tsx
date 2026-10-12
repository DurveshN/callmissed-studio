import Konva from 'konva'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Circle, Ellipse, Group, Layer as KonvaLayer, Line, Rect, Stage, Transformer } from 'react-konva'
import { useShallow } from 'zustand/react/shallow'
import type { Layer } from '@shared/document/model'
import { openLayerMenu } from '../arrange/layer-menu'
import { addLayer, updateLayers } from '../document/layer-ops'
import { newShapeLayer, newTextLayer } from '../document/factories'
import { selectActivePage, useDocumentStore } from '../document/store'
import { useToolStore, type Tool } from '../tools/tool-store'
import { cancelDetect } from '../text-detect/detect'
import { useDetectStore } from '../text-detect/detect-store'
import { DetectBar } from '../text-detect/DetectBar'
import { DetectOverlay } from '../text-detect/DetectOverlay'
import { EraserBar } from '../eraser/EraserBar'
import { eraseStroke, useEraserStore } from '../eraser/eraser'
import { clearSelection, selectAt, selectBox } from '../magic-select/magic-select'
import { SelectBar } from '../magic-select/SelectBar'
import { SelectOverlay } from '../magic-select/SelectOverlay'
import { TaskBar } from '../tasks/TaskBar'
import { CropBar } from '../page-geometry/CropBar'
import { CropOverlay } from '../page-geometry/CropOverlay'
import { LAYER_NAME, LayerNode } from './LayerNode'
import { PageBackground } from './PageBackground'
import { registerPageGroup } from './stage-registry'
import { snap, type Guide, type Rect as Box } from './snapping'
import { TextEditor } from './TextEditor'
import { useViewportStore } from './viewport-store'
import styles from './CanvasView.module.css'

type Drag =
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'marquee' | 'rect' | 'ellipse' | 'line'; x0: number; y0: number; x1: number; y1: number }
  /** Magic Select: a click (tiny drag) selects at a point, a drag selects inside the box. */
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; mode: 'new' | 'add' | 'subtract' }
  | { kind: 'brush'; points: { x: number; y: number }[] }

const SNAP_PX = 6
const MIN_DRAW_PX = 4

function layerGroupOf(node: Konva.Node): Konva.Group | null {
  const found = node.findAncestor(`.${LAYER_NAME}`, true)
  return found instanceof Konva.Group ? found : null
}

function useSpaceKey(): boolean {
  const [down, setDown] = useState(false)
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) =>
      e.target instanceof HTMLElement && e.target.closest('input, textarea, select')
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        e.preventDefault()
        setDown(true)
      }
    }
    const onUp = (e: KeyboardEvent) => e.code === 'Space' && setDown(false)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])
  return down
}

function cursorFor(tool: Tool, panning: boolean, space: boolean): string {
  if (panning) return 'grabbing'
  if (space || tool === 'hand') return 'grab'
  if (tool === 'text') return 'text'
  if (tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'magic') return 'crosshair'
  // The eraser draws its own brush outline.
  if (tool === 'erase') return 'none'
  return 'default'
}

export function CanvasView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const groupRef = useRef<Konva.Group>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  /** Pointer position (page units) for the eraser's brush outline. */
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const brushSize = useEraserStore((s) => s.size)
  const space = useSpaceKey()

  const doc = useDocumentStore((s) => s.doc)
  const page = useDocumentStore(selectActivePage)
  const selection = useDocumentStore((s) => s.selection)
  const select = useDocumentStore((s) => s.select)
  const viewport = useViewportStore(
    useShallow((s) => ({ scale: s.scale, x: s.x, y: s.y, width: s.width, height: s.height }))
  )
  const tool = useToolStore((s) => s.tool)
  /** Eraser brush radius in page units (the size is set in screen pixels). */
  const brushRadius = brushSize / 2 / viewport.scale
  const editingTextId = useToolStore((s) => s.editingTextId)

  // Track container size.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) useViewportStore.getState().setSize(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Fit when a page is shown, the canvas first gets a size, or the page changes size (crop, rotate,
  // resize, a new background — and undoing them).
  const sized = viewport.width > 0 && viewport.height > 0
  const pageId = page?.id
  const pageWidth = page?.width
  const pageHeight = page?.height
  useEffect(() => {
    if (sized && pageWidth && pageHeight) useViewportStore.getState().fit(pageWidth, pageHeight)
  }, [pageId, sized, pageWidth, pageHeight])

  useEffect(() => {
    registerPageGroup(groupRef.current)
    return () => registerPageGroup(null)
  }, [pageId])

  // Detected lines and object selections belong to one page; switching pages ends them.
  useEffect(() => {
    const target = useDetectStore.getState().target
    if (target && target.pageId !== pageId) cancelDetect()
    clearSelection()
  }, [pageId])

  // Attach the transformer to selected, visible, unlocked, non-editing layers.
  const layers = page?.layers
  useEffect(() => {
    const tr = trRef.current
    const stage = tr?.getStage()
    if (!tr || !stage || !layers) return
    // Pixel tools work on the picture; transform handles would get in their way.
    const pixelTool = tool === 'magic' || tool === 'erase' || tool === 'crop'
    const selectable = layers.filter(
      (l) => !pixelTool && selection.includes(l.id) && l.visible && !l.locked && l.id !== editingTextId
    )
    tr.nodes(selectable.map((l) => stage.findOne(`#${l.id}`)).filter((n): n is Konva.Node => !!n))
    const only = selectable.length === 1 ? selectable[0] : undefined
    if (only?.type === 'shape' && only.shape === 'line') {
      tr.enabledAnchors(['middle-left', 'middle-right'])
    } else if (only?.type === 'text') {
      tr.enabledAnchors([
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
        'middle-left',
        'middle-right'
      ])
    } else {
      tr.enabledAnchors([
        'top-left',
        'top-center',
        'top-right',
        'middle-right',
        'middle-left',
        'bottom-left',
        'bottom-center',
        'bottom-right'
      ])
    }
    tr.keepRatio(only?.type === 'image' || only?.type === 'text')
    tr.getLayer()?.batchDraw()
  }, [selection, layers, editingTextId, tool])

  const layerById = useCallback((id: string): Layer | undefined => layers?.find((l) => l.id === id), [layers])

  // ---- transform -----------------------------------------------------------

  const onTransform = () => {
    const tr = trRef.current
    if (!tr) return
    const anchor = tr.getActiveAnchor()
    if (anchor !== 'middle-left' && anchor !== 'middle-right') return
    // Side handles on text reflow the text instead of stretching it.
    for (const node of tr.nodes()) {
      if (layerById(node.id())?.type !== 'text') continue
      const text = (node as Konva.Group).findOne('Text')
      if (!text) continue
      text.width(Math.max(8, text.width() * node.scaleX()))
      node.scaleX(1)
    }
  }

  const onTransformEnd = () => {
    const tr = trRef.current
    if (!tr) return
    const changes = tr.nodes().flatMap((node): [string, Record<string, number>][] => {
      const layer = layerById(node.id())
      if (!layer) return []
      const sx = node.scaleX()
      const sy = node.scaleY()
      node.scale({ x: 1, y: 1 })
      const patch: Record<string, number> = { x: node.x(), y: node.y(), rotation: node.rotation() }
      if (layer.type === 'text') {
        const text = (node as Konva.Group).findOne('Text')
        patch['width'] = Math.max(8, (text?.width() ?? layer.width) * sx)
        if (Math.abs(sy - 1) > 1e-3) patch['fontSize'] = Math.min(2000, Math.max(1, layer.fontSize * sy))
      } else {
        patch['width'] = Math.max(1, layer.width * sx)
        patch['height'] =
          layer.type === 'shape' && layer.shape === 'line' ? 0 : Math.max(1, layer.height * sy)
      }
      return [[layer.id, patch]]
    })
    updateLayers(changes, 'Transform')
  }

  // ---- drag (move, with multi-select and snapping) -------------------------

  const onLayerDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target
    const layer = layerById(node.id())
    if (!layer || !page) return
    const others = layers?.filter((l) => l.visible && !selection.includes(l.id) && l.id !== layer.id) ?? []
    const moving = selection.includes(layer.id) ? selection : [layer.id]

    if (moving.length === 1 && layer.rotation === 0) {
      const box: Box = { x: node.x(), y: node.y(), width: layer.width, height: layer.height }
      const targets: Box[] = [{ x: 0, y: 0, width: page.width, height: page.height }, ...others]
      const result = snap(box, targets, SNAP_PX / viewport.scale)
      node.position({ x: box.x + result.dx, y: box.y + result.dy })
      setGuides(result.guides)
    }

    // Move the rest of the selection by the same delta.
    const dx = node.x() - layer.x
    const dy = node.y() - layer.y
    const stage = node.getStage()
    for (const id of moving) {
      if (id === layer.id) continue
      const other = layerById(id)
      const otherNode = stage?.findOne(`#${id}`)
      if (other && otherNode && !other.locked) otherNode.position({ x: other.x + dx, y: other.y + dy })
    }
  }

  const onLayerDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    setGuides([])
    const node = e.target
    const stage = node.getStage()
    const ids = selection.includes(node.id()) ? selection : [node.id()]
    updateLayers(
      ids.flatMap((id): [string, { x: number; y: number }][] => {
        const n = stage?.findOne(`#${id}`)
        return n && !layerById(id)?.locked ? [[id, { x: n.x(), y: n.y() }]] : []
      }),
      'Move'
    )
  }

  // ---- pointer -------------------------------------------------------------

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!page) return
    const stage = e.target.getStage()
    const pos = stage?.getRelativePointerPosition()
    if (!stage || !pos) return

    if (e.evt.button === 1 || (e.evt.button === 0 && (space || tool === 'hand'))) {
      e.evt.preventDefault()
      setDrag({ kind: 'pan', lastX: e.evt.clientX, lastY: e.evt.clientY })
      return
    }
    if (e.evt.button !== 0) return

    // The crop box and its handles handle their own dragging.
    if (tool === 'crop') return

    if (tool === 'select') {
      if (e.target.findAncestor('Transformer', true)) return
      const group = layerGroupOf(e.target)
      if (group) {
        const id = group.id()
        if (e.evt.shiftKey)
          select(selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id])
        else if (!selection.includes(id)) select([id])
        return
      }
      if (!e.evt.shiftKey) select([])
      setDrag({ kind: 'marquee', x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y })
      return
    }

    if (tool === 'text') {
      // Keep the browser from moving focus to <body>, which would immediately blur the new text editor.
      e.evt.preventDefault()
      const fontSize = Math.max(16, Math.round(Math.min(page.width, page.height) * 0.05))
      const layer = newTextLayer(pos.x, pos.y - fontSize / 2, fontSize)
      addLayer(layer)
      useToolStore.getState().setTool('select')
      useToolStore.getState().editText(layer.id)
      return
    }

    if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
      setDrag({ kind: tool, x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y })
      return
    }

    if (tool === 'magic') {
      const mode = e.evt.shiftKey ? 'add' : e.evt.altKey ? 'subtract' : 'new'
      setDrag({ kind: 'box', x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y, mode })
      return
    }

    if (tool === 'erase') setDrag({ kind: 'brush', points: [{ x: pos.x, y: pos.y }] })
  }

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === 'erase') setHover(e.target.getStage()?.getRelativePointerPosition() ?? null)
    if (!drag) return
    if (drag.kind === 'pan') {
      useViewportStore.getState().panBy(e.evt.clientX - drag.lastX, e.evt.clientY - drag.lastY)
      setDrag({ ...drag, lastX: e.evt.clientX, lastY: e.evt.clientY })
      return
    }
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    if (drag.kind === 'brush') {
      const last = drag.points.at(-1)
      // Sample the stroke about every quarter brush radius.
      if (!last || Math.hypot(pos.x - last.x, pos.y - last.y) >= brushRadius * 0.25) {
        setDrag({ kind: 'brush', points: [...drag.points, { x: pos.x, y: pos.y }] })
      }
      return
    }
    setDrag({ ...drag, x1: pos.x, y1: pos.y })
  }

  const finishDrag = () => {
    if (!drag || !page) return setDrag(null)
    setDrag(null)
    if (drag.kind === 'pan') return
    if (drag.kind === 'brush') return eraseStroke(drag.points, brushRadius)

    const x = Math.min(drag.x0, drag.x1)
    const y = Math.min(drag.y0, drag.y1)
    const w = Math.abs(drag.x1 - drag.x0)
    const h = Math.abs(drag.y1 - drag.y0)
    const tiny = Math.max(w, h) * viewport.scale < MIN_DRAW_PX

    if (drag.kind === 'box') {
      if (tiny || drag.mode !== 'new') selectAt({ x: drag.x0, y: drag.y0 }, drag.mode)
      else selectBox({ x: drag.x0, y: drag.y0 }, { x: drag.x1, y: drag.y1 })
      return
    }

    if (drag.kind === 'marquee') {
      if (tiny) return
      const hits = (page.layers ?? []).filter(
        (l) =>
          l.visible &&
          !l.locked &&
          l.x < x + w &&
          l.x + l.width > x &&
          l.y < y + h &&
          l.y + Math.max(l.height, 1) > y
      )
      const ids = hits.map((l) => l.id)
      select([...new Set([...useDocumentStore.getState().selection, ...ids])])
      return
    }

    const stroke = Math.max(2, Math.round(Math.min(page.width, page.height) / 250))
    const unit = Math.min(page.width, page.height) * 0.2
    if (drag.kind === 'line') {
      const dx = drag.x1 - drag.x0
      const dy = drag.y1 - drag.y0
      const length = tiny ? unit : Math.hypot(dx, dy)
      const rotation = tiny ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI
      addLayer(newShapeLayer('line', { x: drag.x0, y: drag.y0, width: length, height: 0, rotation }, stroke))
    } else {
      const box = tiny
        ? { x: drag.x0, y: drag.y0, width: unit, height: unit * 0.66 }
        : { x, y, width: w, height: h }
      addLayer(newShapeLayer(drag.kind, box, stroke))
    }
    useToolStore.getState().setTool('select')
  }

  // Finish drags released outside the canvas.
  useEffect(() => {
    if (!drag) return
    const up = () => finishDrag()
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  })

  const onContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault()
    const group = layerGroupOf(e.target)
    if (group && tool === 'select') openLayerMenu(e.evt.clientX, e.evt.clientY, group.id())
  }

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const vp = useViewportStore.getState()
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const pointer = e.target.getStage()?.getPointerPosition() ?? undefined
      vp.zoomBy(Math.exp(-e.evt.deltaY * 0.0015), pointer)
    } else if (e.evt.shiftKey) {
      vp.panBy(-e.evt.deltaY, 0)
    } else {
      vp.panBy(-e.evt.deltaX, -e.evt.deltaY)
    }
  }

  if (!doc || !page) return <div ref={containerRef} className={styles.container} />

  const editingLayer = page.layers.find((l) => l.id === editingTextId)
  const draft = drag && drag.kind !== 'pan' && drag.kind !== 'brush' ? drag : null
  const stroke = drag?.kind === 'brush' ? drag : null
  const px = 1 / viewport.scale

  return (
    <div
      ref={containerRef}
      className={styles.container}
      style={{ cursor: cursorFor(tool, drag?.kind === 'pan', space) }}
      data-testid="canvas"
    >
      <Stage
        width={viewport.width}
        height={viewport.height}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={finishDrag}
        onMouseLeave={() => setHover(null)}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
      >
        <KonvaLayer listening={false}>
          <Rect
            width={page.width}
            height={page.height}
            fill="#ffffff"
            shadowColor="#000000"
            shadowOpacity={0.18}
            shadowBlur={24 * px}
            shadowOffsetY={4 * px}
          />
        </KonvaLayer>
        <KonvaLayer>
          <Group ref={groupRef} clipX={0} clipY={0} clipWidth={page.width} clipHeight={page.height}>
            <PageBackground doc={doc} page={page} />
            {page.layers
              .filter((l) => l.visible)
              .map((layer) => (
                <LayerNode
                  key={layer.id}
                  layer={layer}
                  docId={doc.id}
                  draggable={tool === 'select' && !space && !layer.locked && layer.id !== editingTextId}
                  editing={layer.id === editingTextId}
                  onDragMove={onLayerDragMove}
                  onDragEnd={onLayerDragEnd}
                  onDblClick={(l) => l.type === 'text' && useToolStore.getState().editText(l.id)}
                />
              ))}
          </Group>
        </KonvaLayer>
        <KonvaLayer>
          <Transformer
            ref={trRef}
            rotateEnabled
            flipEnabled={false}
            ignoreStroke
            borderStroke="#5b4cf0"
            anchorStroke="#5b4cf0"
            anchorSize={9}
            anchorCornerRadius={2}
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            onTransform={onTransform}
            onTransformEnd={onTransformEnd}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 4 || newBox.height < 0 ? oldBox : newBox)}
          />
          {guides.map((g, i) => (
            <Line
              key={i}
              points={g.orientation === 'vertical' ? [g.at, -1e5, g.at, 1e5] : [-1e5, g.at, 1e5, g.at]}
              stroke="#e5484d"
              strokeWidth={px}
              listening={false}
            />
          ))}
          {draft && <DraftShape drag={draft} px={px} />}
          <DetectOverlay pageId={page.id} px={px} />
          <SelectOverlay pageId={page.id} px={px} />
          {tool === 'crop' && <CropOverlay px={px} />}
          {stroke && (
            <Line
              points={stroke.points.flatMap((p) => [p.x, p.y])}
              stroke="rgba(229, 72, 77, 0.4)"
              strokeWidth={brushRadius * 2}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          )}
          {tool === 'erase' && hover && (
            <Circle
              x={hover.x}
              y={hover.y}
              radius={brushRadius}
              stroke="#ffffff"
              strokeWidth={2 * px}
              shadowColor="#000000"
              shadowBlur={2 * px}
              shadowOpacity={0.8}
              listening={false}
            />
          )}
        </KonvaLayer>
      </Stage>
      {editingLayer?.type === 'text' && <TextEditor key={editingLayer.id} layer={editingLayer} />}
      <DetectBar />
      <SelectBar />
      <EraserBar />
      <TaskBar />
      <CropBar />
    </div>
  )
}

function DraftShape({ drag, px }: { drag: Exclude<Drag, { kind: 'pan' } | { kind: 'brush' }>; px: number }) {
  const x = Math.min(drag.x0, drag.x1)
  const y = Math.min(drag.y0, drag.y1)
  const width = Math.abs(drag.x1 - drag.x0)
  const height = Math.abs(drag.y1 - drag.y0)
  const style = { stroke: '#5b4cf0', strokeWidth: px, dash: [4 * px, 4 * px], listening: false }
  if (drag.kind === 'line') return <Line points={[drag.x0, drag.y0, drag.x1, drag.y1]} {...style} />
  if (drag.kind === 'ellipse') {
    return (
      <Ellipse x={x + width / 2} y={y + height / 2} radiusX={width / 2} radiusY={height / 2} {...style} />
    )
  }
  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={height}
      {...style}
      fill={drag.kind === 'marquee' || drag.kind === 'box' ? 'rgba(91,76,240,0.08)' : undefined}
    />
  )
}
