import { describe, expect, it } from 'vitest'
import { chooseFonts, type MatchedLine } from '../../src/renderer/src/features/fonts/font-consensus'
import type { FontCandidate } from '../../src/renderer/src/features/fonts/font-match-protocol'

const cand = (family: string, weight: number, score: number, fontSize = 20): FontCandidate => ({
  family,
  weight,
  score,
  fontSize,
  inkLeft: 0,
  inkTop: 0
})

/** `size` scales the crop so lines can be given different page sizes. */
function line(id: string, size: number, color: string, ...alternatives: FontCandidate[]): MatchedLine {
  return { id, scale: size / 20, color, match: { ...(alternatives[0] as FontCandidate), alternatives } }
}

describe('chooseFonts', () => {
  it('lets a line follow its style group when the shared font fits nearly as well', () => {
    const chosen = chooseFonts([
      line('a', 16, '#202020', cand('Calibri', 400, 0.8), cand('Calibri', 700, 0.75)),
      line('b', 16, '#202020', cand('Calibri', 400, 0.82), cand('Calibri', 700, 0.7)),
      // Noisy line: bold wins narrowly on its own.
      line('c', 16.5, '#222222', cand('Calibri', 700, 0.78), cand('Calibri', 400, 0.76))
    ])
    expect(chosen.get('c')).toMatchObject({ family: 'Calibri', weight: 400 })
  })

  it('keeps a genuinely different line (clearly better match of its own)', () => {
    const chosen = chooseFonts([
      line('a', 16, '#202020', cand('Calibri', 400, 0.8), cand('Calibri', 700, 0.6)),
      line('b', 16, '#202020', cand('Calibri', 400, 0.8), cand('Calibri', 700, 0.6)),
      line('bold', 16, '#202020', cand('Calibri', 700, 0.85), cand('Calibri', 400, 0.6))
    ])
    expect(chosen.get('bold')).toMatchObject({ weight: 700 })
  })

  it('groups by size measured in a common font, so a misfit best match does not split the group', () => {
    const chosen = chooseFonts([
      line('a', 20, '#202020', cand('Calibri', 400, 0.6, 22), cand('Calibri', 700, 0.55, 21)),
      line('b', 20, '#202020', cand('Calibri', 400, 0.62, 22), cand('Calibri', 700, 0.5, 21)),
      // Its own best guess is a narrower font with a much smaller size estimate.
      line('c', 20, '#202020', cand('Trebuchet MS', 700, 0.58, 18.8), cand('Calibri', 400, 0.57, 22))
    ])
    expect(chosen.get('c')).toMatchObject({ family: 'Calibri', weight: 400 })
  })

  it('does not group lines of different size or color', () => {
    const chosen = chooseFonts([
      line('title', 26, '#101010', cand('Calibri', 700, 0.8), cand('Calibri', 400, 0.79)),
      line('body', 16, '#101010', cand('Calibri', 400, 0.8), cand('Calibri', 700, 0.79)),
      line('red', 26, '#e01010', cand('Lato', 400, 0.8), cand('Calibri', 700, 0.79))
    ])
    expect(chosen.get('title')).toMatchObject({ weight: 700 })
    expect(chosen.get('body')).toMatchObject({ weight: 400 })
    expect(chosen.get('red')).toMatchObject({ family: 'Lato' })
  })
})
