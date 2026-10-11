import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/renderer/src/features/canvas/text-metrics', () => ({
  measureTextHeight: () => 20,
  fontStyle: () => 'normal'
}))

const { canArrange } = await import('../../src/renderer/src/features/arrange/arrange')
const { newShapeLayer } = await import('../../src/renderer/src/features/document/factories')

// Bottom-first, like page.layers.
const layers = ['A', 'B', 'C', 'D'].map((name) => ({
  ...newShapeLayer('rect', { x: 0, y: 0, width: 1, height: 1 }, 1),
  id: name
}))

describe('canArrange', () => {
  it('disables upward moves for layers already on top', () => {
    expect(canArrange(layers, ['D'], 'front')).toBe(false)
    expect(canArrange(layers, ['D'], 'forward')).toBe(false)
    expect(canArrange(layers, ['C', 'D'], 'forward')).toBe(false)
    expect(canArrange(layers, ['D'], 'backward')).toBe(true)
  })

  it('disables downward moves for layers already just above the background', () => {
    expect(canArrange(layers, ['A'], 'back')).toBe(false)
    expect(canArrange(layers, ['A', 'B'], 'backward')).toBe(false)
    expect(canArrange(layers, ['A'], 'front')).toBe(true)
  })

  it('enables moves for non-contiguous selections', () => {
    expect(canArrange(layers, ['B', 'D'], 'front')).toBe(true)
    expect(canArrange(layers, ['A', 'C'], 'back')).toBe(true)
  })

  it('is disabled with nothing selected', () => {
    expect(canArrange(layers, [], 'front')).toBe(false)
  })
})
