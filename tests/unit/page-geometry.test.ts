import { describe, expect, it } from 'vitest'
import type { ImageLayer, ShapeLayer, TextLayer } from '../../src/shared/document/model'
import {
  clampBox,
  croppedLayerBox,
  rotateLayer,
  scaleLayer,
  shiftLayer
} from '../../src/renderer/src/features/page-geometry/transform'

const base = { name: 'L', visible: true, locked: false, opacity: 1 }
const image: ImageLayer = {
  ...base,
  id: '00000000-0000-4000-8000-000000000001',
  type: 'image',
  assetId: '00000000-0000-4000-8000-000000000002',
  origin: 'import',
  x: 10,
  y: 20,
  width: 30,
  height: 40,
  rotation: 0
}

/** Page-space corners of a layer box (top-left, top-right, bottom-left). */
function corners(l: { x: number; y: number; width: number; height: number; rotation: number }) {
  const r = (l.rotation * Math.PI) / 180
  const at = (u: number, v: number) => [
    +(l.x + u * Math.cos(r) - v * Math.sin(r)).toFixed(6),
    +(l.y + u * Math.sin(r) + v * Math.cos(r)).toFixed(6)
  ]
  return [at(0, 0), at(l.width, 0), at(0, l.height)]
}

describe('page geometry', () => {
  it('moves a layer', () => {
    expect(shiftLayer(image, -5, 7)).toMatchObject({ x: 5, y: 27 })
  })

  it('turns layers with the page, 90° either way', () => {
    // Page 200 × 100. Clockwise, a page point (x, y) goes to (100 − y, x).
    const cw = rotateLayer(image, true, 200, 100)
    expect(corners(cw)).toEqual([
      [80, 10],
      [80, 40],
      [40, 10]
    ])
    expect(cw.rotation).toBe(90)
    // Counter-clockwise, (x, y) goes to (y, 200 − x); turning back restores the layer.
    const back = rotateLayer(cw, false, 100, 200)
    expect(corners(back)).toEqual(corners(image))
    expect(back.rotation).toBe(0)
  })

  it('scales positions, sizes, font sizes and strokes', () => {
    const text = { ...image, type: 'text', fontSize: 12 } as unknown as TextLayer
    const shape = { ...image, type: 'shape', strokeWidth: 3 } as unknown as ShapeLayer
    expect(scaleLayer(image, 2)).toMatchObject({ x: 20, y: 40, width: 60, height: 80 })
    expect(scaleLayer(text, 0.5).fontSize).toBe(6)
    expect(scaleLayer(shape, 2).strokeWidth).toBe(6)
  })

  it('keeps a crop box inside its picture', () => {
    expect(clampBox({ x: -10, y: 5, width: 50, height: 500 }, 100, 100)).toEqual({
      x: 0,
      y: 5,
      width: 40,
      height: 95
    })
  })

  it('places a cropped image layer where its kept part was', () => {
    expect(croppedLayerBox(image, { x: 5, y: 10, width: 20, height: 20 })).toEqual({
      x: 15,
      y: 30,
      width: 20,
      height: 20
    })
    const turned = { ...image, rotation: 90 }
    const box = croppedLayerBox(turned, { x: 5, y: 10, width: 20, height: 20 })
    expect(box.x).toBeCloseTo(0)
    expect(box.y).toBeCloseTo(25)
  })
})
