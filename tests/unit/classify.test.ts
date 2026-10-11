import { describe, expect, it } from 'vitest'
import { looksHandwritten } from '../../src/renderer/src/features/text-detect/classify'
import type { FontMatchResult } from '../../src/renderer/src/features/fonts/font-match-protocol'

const match = (family: string, score: number): FontMatchResult => {
  const best = { family, weight: 400, fontSize: 20, score, inkLeft: 0, inkTop: 0 }
  return { ...best, alternatives: [best] }
}

// Values measured on a phone photo of a printed notice with two signatures.
describe('looksHandwritten', () => {
  it('flags signatures and marks by their low recognition confidence', () => {
    expect(looksHandwritten(0.522, match('Anton', 0.085))).toBe(true)
    expect(looksHandwritten(0.861, match('Oswald', 0.131))).toBe(true)
    expect(looksHandwritten(0.629, match('Montserrat', -0.044))).toBe(true)
  })

  it('keeps printed text, including short labels and poorly lit bold headings', () => {
    expect(looksHandwritten(0.904, match('Source Serif 4', 0.572))).toBe(false)
    expect(looksHandwritten(0.981, match('Calibri', 0.143))).toBe(false)
    expect(looksHandwritten(0.977, match('Playfair Display', -0.009))).toBe(false)
  })

  it('flags text whose best fit is a handwriting font', () => {
    expect(looksHandwritten(0.95, match('Caveat', 0.5))).toBe(true)
  })
})
