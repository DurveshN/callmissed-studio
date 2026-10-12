import { describe, expect, it } from 'vitest'
import {
  cutoutPixels,
  featherMask,
  growMask,
  maskInRegion,
  maskRegion,
  strokeMask
} from '../../src/renderer/src/features/raster/mask'

const dot = (x: number, y: number) => ({ x, y, width: 1, height: 1, data: Uint8Array.of(255) })
const count = (data: Uint8Array) => data.filter((v) => v).length

describe('raster masks', () => {
  it('grows a mask squarely and clips it to the raster', () => {
    expect(growMask(dot(5, 5), 2, 20, 20)).toMatchObject({ x: 3, y: 3, width: 5, height: 5 })
    const edge = growMask(dot(0, 0), 2, 20, 20)
    expect(edge).toMatchObject({ x: 0, y: 0, width: 3, height: 3 })
    expect(count(edge.data)).toBe(9)
  })

  it('rasterizes a brush stroke as a capsule', () => {
    const stroke = strokeMask(
      [
        { x: 10, y: 10 },
        { x: 30, y: 10 }
      ],
      3,
      100,
      100
    )
    if (!stroke) throw new Error('no stroke')
    const at = (x: number, y: number) =>
      x < stroke.x || y < stroke.y || x >= stroke.x + stroke.width || y >= stroke.y + stroke.height
        ? 0
        : stroke.data[(y - stroke.y) * stroke.width + x - stroke.x]
    expect(at(20, 10)).toBe(255) // along the segment
    expect(at(20, 12)).toBe(255) // within the radius
    expect(at(20, 14)).toBe(0) // beyond it
    expect(at(8, 10)).toBe(255) // round cap
    expect(strokeMask([], 3, 100, 100)).toBeNull()
  })

  it('places a mask into a region and cuts pixels out with its alpha', () => {
    const mask = { x: 1, y: 1, width: 2, height: 1, data: Uint8Array.of(255, 128) }
    const region = maskRegion(mask, 1, 4, 4)
    expect(region).toEqual({ x: 0, y: 0, width: 4, height: 3 })
    expect(Array.from(maskInRegion(mask, region))).toEqual([0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 0])

    const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(200)
    const cut = cutoutPixels(rgba, 4, mask)
    expect(Array.from(cut)).toEqual([200, 200, 200, 200, 200, 200, 200, 100])
  })

  it('feathers hard edges into partial alpha', () => {
    const square = { x: 2, y: 2, width: 4, height: 4, data: new Uint8Array(16).fill(255) }
    const soft = featherMask(square, 10, 10)
    expect(soft).toMatchObject({ x: 1, y: 1, width: 6, height: 6 })
    const at = (x: number, y: number) => soft.data[(y - soft.y) * soft.width + x - soft.x] as number
    expect(at(4, 4)).toBe(255) // interior
    expect(at(2, 4)).toBeGreaterThan(0) // edge softened, not removed
    expect(at(2, 4)).toBeLessThan(255)
    expect(at(1, 4)).toBeGreaterThan(0) // halo outside
  })
})
