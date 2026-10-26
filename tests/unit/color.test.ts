import { describe, expect, it } from 'vitest'
import { hexToHsv, hsvToHex, normalizeHex } from '../../src/renderer/src/ui/color'

describe('colour conversions', () => {
  it('reads the hex forms people type', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex(' cc2200 ')).toBe('#cc2200')
    expect(normalizeHex('#11223344')).toBe('#112233')
    expect(normalizeHex('red')).toBeNull()
    expect(normalizeHex('#12345')).toBeNull()
  })

  it('round-trips through hue, saturation and value', () => {
    for (const hex of [
      '#000000',
      '#ffffff',
      '#ff0000',
      '#00ff00',
      '#0000ff',
      '#cc2200',
      '#5b4cf0',
      '#808080'
    ])
      expect(hsvToHex(hexToHsv(hex))).toBe(hex)
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 })
    expect(hexToHsv('#0000ff').h).toBe(240)
  })
})
