import type { FontCandidate, FontMatchResult } from './font-match-protocol'

export interface MatchedLine {
  id: string
  /** Page units per crop pixel (font sizes in matches are in crop pixels). */
  scale: number
  /** Text color, #rrggbb. */
  color: string
  match: FontMatchResult | null
}

/** Lines whose font sizes differ by less than this share are treated as the same text style. */
const SIZE_TOLERANCE = 0.12
/** …and whose colors are this close (RGB distance). */
const COLOR_TOLERANCE = 48
/**
 * A line takes its group's font if that font scores within this share of the line's own best score.
 * Relative, because small text scores low and noisily while large text scores high and decisively.
 */
const SCORE_TOLERANCE = 0.15

const key = (c: { family: string; weight: number }) => `${c.family}|${c.weight}`

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2)
}

/**
 * Picks a font for every line, preferring consistency: lines of the same size and color (the same
 * text style in a design) vote on a shared font, summing their candidate scores. Each line adopts
 * the group's font when it scores nearly as well for that line; a genuinely different line (e.g. a
 * bold word among regular text) keeps its own best match.
 */
export function chooseFonts(lines: MatchedLine[]): Map<string, FontCandidate | null> {
  // Sizes estimated with different fonts are not comparable, so compare every line's size under one
  // reference family: the one best supported across all lines' top candidates.
  const support = new Map<string, number>()
  for (const line of lines) {
    for (const c of line.match?.alternatives.slice(0, 3) ?? [])
      support.set(c.family, (support.get(c.family) ?? 0) + c.score)
  }
  const reference = [...support.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const size = (line: MatchedLine) => {
    const match = line.match as FontMatchResult
    return (match.alternatives.find((c) => c.family === reference) ?? match).fontSize * line.scale
  }

  const groups: MatchedLine[][] = []
  for (const line of lines) {
    if (!line.match) continue
    const group = groups.find((g) => {
      const first = g[0] as MatchedLine
      return (
        Math.abs(size(line) - size(first)) / Math.max(1, size(first)) < SIZE_TOLERANCE &&
        colorDistance(line.color, first.color) < COLOR_TOLERANCE
      )
    })
    if (group) group.push(line)
    else groups.push([line])
  }

  const chosen = new Map<string, FontCandidate | null>()
  for (const line of lines) chosen.set(line.id, line.match)
  for (const group of groups) {
    if (group.length < 2) continue
    const totals = new Map<string, number>()
    for (const line of group) {
      const alternatives = line.match?.alternatives ?? []
      // A font missing from a line's shortlist counts as that line's worst listed score.
      const floor = alternatives.at(-1)?.score ?? -0.6
      const seen = new Set(alternatives.map(key))
      for (const c of alternatives) totals.set(key(c), (totals.get(key(c)) ?? 0) + c.score)
      for (const k of totals.keys()) if (!seen.has(k)) totals.set(k, (totals.get(k) ?? 0) + floor)
    }
    const winner = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (!winner) continue
    for (const line of group) {
      const best = line.match
      const candidate = best?.alternatives.find((c) => key(c) === winner)
      if (best && candidate && candidate.score >= best.score * (1 - SCORE_TOLERANCE))
        chosen.set(line.id, candidate)
    }
  }
  return chosen
}
