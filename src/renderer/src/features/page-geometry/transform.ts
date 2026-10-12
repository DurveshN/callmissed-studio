import type { Layer } from '@shared/document/model'

/** A rectangle in page (or layer-local) units. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The layer moved by (dx, dy). */
export function shiftLayer<L extends Layer>(layer: L, dx: number, dy: number): L {
  return { ...layer, x: layer.x + dx, y: layer.y + dy }
}

/**
 * The layer after the page (width × height before turning) turns 90° clockwise (`cw`) or
 * counter-clockwise: its origin follows the turn and its rotation grows by ±90°.
 */
export function rotateLayer<L extends Layer>(
  layer: L,
  cw: boolean,
  pageWidth: number,
  pageHeight: number
): L {
  const x = cw ? pageHeight - layer.y : layer.y
  const y = cw ? layer.x : pageWidth - layer.x
  const rotation = ((((layer.rotation + (cw ? 90 : -90)) % 360) + 540) % 360) - 180
  return { ...layer, x, y, rotation }
}

/** The layer scaled by `s` about the page origin (sizes, font sizes and stroke widths too). */
export function scaleLayer<L extends Layer>(layer: L, s: number): L {
  const scaled = {
    ...layer,
    x: layer.x * s,
    y: layer.y * s,
    width: layer.width * s,
    height: layer.height * s
  }
  if (scaled.type === 'text') return { ...scaled, fontSize: Math.min(2000, scaled.fontSize * s) }
  if (scaled.type === 'shape') return { ...scaled, strokeWidth: Math.min(500, scaled.strokeWidth * s) }
  return scaled
}

/** `box` kept inside 0..width × 0..height, at least 1 unit in size. */
export function clampBox(box: Box, width: number, height: number): Box {
  const x = Math.min(Math.max(0, box.x), width - 1)
  const y = Math.min(Math.max(0, box.y), height - 1)
  return {
    x,
    y,
    width: Math.max(1, Math.min(box.width + Math.min(0, box.x), width - x)),
    height: Math.max(1, Math.min(box.height + Math.min(0, box.y), height - y))
  }
}

/**
 * Position and size of an image layer cropped to `crop` (in its own unrotated units, 0..width ×
 * 0..height): the crop's top-left corner, turned with the layer, becomes the new origin.
 */
export function croppedLayerBox(layer: Layer, crop: Box): Box {
  const rad = (layer.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    x: layer.x + crop.x * cos - crop.y * sin,
    y: layer.y + crop.x * sin + crop.y * cos,
    width: crop.width,
    height: crop.height
  }
}
