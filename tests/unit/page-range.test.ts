import { describe, expect, it } from 'vitest'
import { parsePageRange } from '../../src/renderer/src/features/pages/page-range'

describe('page ranges', () => {
  it('reads single pages, ranges and open ends, in the order written', () => {
    expect(parsePageRange('1-3, 5', 6)).toEqual([0, 1, 2, 4])
    expect(parsePageRange('4-', 6)).toEqual([3, 4, 5])
    expect(parsePageRange('-2', 6)).toEqual([0, 1])
    expect(parsePageRange('3-1', 6)).toEqual([2, 1, 0])
    expect(parsePageRange(' 2 ,, 2 ', 6)).toEqual([1, 1])
  })

  it('rejects empty, malformed and out-of-range input', () => {
    for (const text of ['', ' , ', 'a', '1-2-3', '0', '7', '2-9', '-']) {
      expect(parsePageRange(text, 6), text).toBeNull()
    }
  })
})
