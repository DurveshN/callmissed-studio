import { describe, expect, it } from 'vitest'
import { snap } from '../../src/renderer/src/features/canvas/snapping'

const page = { x: 0, y: 0, width: 1000, height: 800 }

describe('snap', () => {
  it('snaps a box center to the page center', () => {
    const result = snap({ x: 447, y: 352, width: 100, height: 100 }, [page], 5)
    expect(result).toEqual({
      dx: 3,
      dy: -2,
      guides: [
        { orientation: 'vertical', at: 500 },
        { orientation: 'horizontal', at: 400 }
      ]
    })
  })

  it('snaps edges to another layer', () => {
    const other = { x: 300, y: 100, width: 50, height: 50 }
    const result = snap({ x: 352, y: 600, width: 40, height: 40 }, [other], 5)
    expect(result.dx).toBe(-2)
    expect(result.dy).toBe(0)
  })

  it('does nothing outside the threshold', () => {
    expect(snap({ x: 120, y: 130, width: 10, height: 10 }, [page], 5)).toEqual({ dx: 0, dy: 0, guides: [] })
  })
})
