import { useMemo } from 'react'
import { Circle, Group, Image as KonvaImage } from 'react-konva'
import type { MaskCrop } from '@shared/ml/jobs'
import { useSelectStore } from './select-store'

/** Tinted fill with a solid outline, as a canvas the size of the mask. */
function maskCanvas(mask: MaskCrop): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = mask.width
  canvas.height = mask.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.createImageData(mask.width, mask.height)
  const on = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < mask.width && y < mask.height && !!mask.data[y * mask.width + x]
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!on(x, y)) continue
      const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1)
      image.data.set(edge ? [91, 76, 240, 255] : [91, 76, 240, 110], (y * mask.width + x) * 4)
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/** The selected object (tinted, outlined) and the clicks that defined it, over its picture. */
export function SelectOverlay({ pageId, px }: { pageId: string; px: number }) {
  const { mask, points, placement, target } = useSelectStore()
  const canvas = useMemo(() => (mask ? maskCanvas(mask) : null), [mask])
  if (!placement || target?.pageId !== pageId) return null
  // Markers keep a constant screen size inside the (scaled) raster group.
  const unit = px / Math.max(placement.scaleX, 1e-6)
  return (
    <Group {...placement} listening={false}>
      {canvas && mask && (
        <KonvaImage image={canvas} x={mask.x} y={mask.y} width={mask.width} height={mask.height} />
      )}
      {points.map((p, i) => (
        <Circle
          key={i}
          x={p.x}
          y={p.y}
          radius={5 * unit}
          fill={p.label ? '#22a06b' : '#e5484d'}
          stroke="#ffffff"
          strokeWidth={1.5 * unit}
        />
      ))}
    </Group>
  )
}
