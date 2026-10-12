import { describe, expect, it } from 'vitest'
import { adjustPixels, isNeutral, NEUTRAL } from '../../src/renderer/src/features/adjust/adjust'

const px = (...rgba: number[]) => Uint8ClampedArray.from(rgba)
const run = (data: Uint8ClampedArray, a: Partial<typeof NEUTRAL>) => {
  adjustPixels(data, { ...NEUTRAL, ...a })
  return Array.from(data)
}

describe('adjustments', () => {
  it('leaves pixels unchanged when neutral', () => {
    expect(run(px(10, 128, 250, 77), {})).toEqual([10, 128, 250, 77])
    expect(isNeutral(undefined)).toBe(true)
    expect(isNeutral({ ...NEUTRAL, contrast: 0.1 })).toBe(false)
  })

  it('shifts brightness and keeps alpha', () => {
    expect(run(px(100, 100, 100, 50), { brightness: 0.2 })).toEqual([151, 151, 151, 50])
    expect(run(px(100, 100, 100, 255), { brightness: -1 })).toEqual([0, 0, 0, 255])
  })

  it('scales contrast around mid-grey', () => {
    expect(run(px(64, 128, 192, 255), { contrast: -1 })).toEqual([128, 128, 128, 255])
    const [dark, mid, light] = run(px(64, 128, 192, 255), { contrast: 0.5 })
    expect(mid).toBe(128)
    expect(dark).toBe(0)
    expect(light).toBe(255)
  })

  it('scales saturation from each pixel’s luma', () => {
    const [r, g, b] = run(px(200, 100, 50, 255), { saturation: -1 })
    expect(r).toBe(g)
    expect(g).toBe(b)
    const [r2, , b2] = run(px(200, 100, 50, 255), { saturation: 0.5 })
    expect(r2).toBeGreaterThan(200)
    expect(b2).toBeLessThan(50)
  })
})
