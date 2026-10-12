import type Konva from 'konva'
import { useRef } from 'react'
import { Ellipse, Group, Image as KonvaImage, Line, Rect, Text } from 'react-konva'
import type { ImageLayer, Layer, ShapeLayer, TextLayer } from '@shared/document/model'
import { useAdjustments } from '../adjust/use-adjustments'
import { useAssetImage } from '../assets/asset-cache'
import { fontStyle } from './text-metrics'

export const LAYER_NAME = 'studio-layer'

interface Props {
  layer: Layer
  docId: string
  draggable: boolean
  /** Hides the Konva text while it is edited in the DOM overlay. */
  editing: boolean
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void
  onDblClick?: (layer: Layer) => void
}

function TextContent({ layer, editing }: { layer: TextLayer; editing: boolean }) {
  return (
    <Text
      text={layer.text}
      width={layer.width}
      fontFamily={layer.fontFamily}
      fontSize={layer.fontSize}
      fontStyle={fontStyle(layer)}
      fill={layer.color}
      align={layer.align}
      lineHeight={layer.lineHeight}
      wrap="word"
      opacity={editing ? 0 : 1}
    />
  )
}

function ShapeContent({ layer }: { layer: ShapeLayer }) {
  const paint = {
    fill: layer.fill ?? undefined,
    stroke: layer.stroke ?? undefined,
    strokeWidth: layer.stroke ? layer.strokeWidth : 0
  }
  if (layer.shape === 'ellipse') {
    return (
      <Ellipse
        x={layer.width / 2}
        y={layer.height / 2}
        radiusX={layer.width / 2}
        radiusY={layer.height / 2}
        {...paint}
      />
    )
  }
  if (layer.shape === 'line') {
    return (
      <Line
        points={[0, 0, layer.width, 0]}
        stroke={layer.stroke ?? '#000000'}
        strokeWidth={layer.strokeWidth}
        lineCap="round"
        hitStrokeWidth={Math.max(12, layer.strokeWidth)}
      />
    )
  }
  return <Rect width={layer.width} height={layer.height} {...paint} />
}

function ImageContent({ layer, docId }: { layer: ImageLayer; docId: string }) {
  const image = useAssetImage(docId, layer.assetId)
  const ref = useRef<Konva.Image>(null)
  // Cached at the image's own resolution, however small the layer is drawn.
  const pixelRatio = image ? image.naturalWidth / Math.max(1, layer.width) : 1
  useAdjustments(ref, layer.adjustments, pixelRatio, [image, layer.width, layer.height])
  return image ? (
    <KonvaImage ref={ref} image={image} width={layer.width} height={layer.height} />
  ) : (
    <Rect width={layer.width} height={layer.height} fill="#e4e4e7" />
  )
}

/** One document layer as a Konva group positioned by the layer box. */
export function LayerNode({ layer, docId, draggable, editing, onDragMove, onDragEnd, onDblClick }: Props) {
  return (
    <Group
      id={layer.id}
      name={LAYER_NAME}
      x={layer.x}
      y={layer.y}
      rotation={layer.rotation}
      opacity={layer.opacity}
      draggable={draggable}
      listening={!layer.locked}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDblClick={() => onDblClick?.(layer)}
    >
      {layer.type === 'text' && <TextContent layer={layer} editing={editing} />}
      {layer.type === 'shape' && <ShapeContent layer={layer} />}
      {layer.type === 'image' && <ImageContent layer={layer} docId={docId} />}
    </Group>
  )
}
