import { rectAtAngle, rectCorners, type RotatedRect } from '../../image/geometry'

export interface Word {
  text: string
  confidence: number
  rect: RotatedRect
  /** Number of detected word boxes merged into this entry (1 for a single word). */
  words?: number
}

/** Words join a line when they agree in angle and size, share a baseline and the gap is word-sized. */
const MAX_ANGLE_DIFF = 4
const MIN_HEIGHT_RATIO = 0.65
const MAX_OFFSET = 0.35
const MAX_GAP = 1.2

/** Position of `rect`'s center along (u) and across (v) the reading direction of `base`. */
function project(base: RotatedRect, rect: RotatedRect): { u: number; v: number } {
  const rad = (base.angle * Math.PI) / 180
  const dx = rect.cx - base.cx
  const dy = rect.cy - base.cy
  return { u: dx * Math.cos(rad) + dy * Math.sin(rad), v: -dx * Math.sin(rad) + dy * Math.cos(rad) }
}

function joinable(a: RotatedRect, b: RotatedRect): boolean {
  let angle = Math.abs(a.angle - b.angle)
  if (angle > 90) angle = 180 - angle
  if (angle > MAX_ANGLE_DIFF) return false
  const ratio = Math.min(a.height, b.height) / Math.max(a.height, b.height)
  if (ratio < MIN_HEIGHT_RATIO) return false
  const h = Math.max(a.height, b.height)
  const { u, v } = project(a, b)
  if (Math.abs(v) > MAX_OFFSET * h) return false
  const gap = Math.abs(u) - (a.width + b.width) / 2
  return gap < MAX_GAP * h
}

/**
 * Groups detected word boxes into text lines (single-linkage on `joinable`), orders words along
 * the reading direction and joins their text with spaces.
 */
export function groupLines(words: Word[]): Word[] {
  const parent = words.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i] as number)))
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      if (joinable((words[i] as Word).rect, (words[j] as Word).rect)) parent[root(j)] = root(i)
    }
  }
  const groups = new Map<number, Word[]>()
  words.forEach((w, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), w]))

  const lines: Word[] = []
  for (const group of groups.values()) {
    const first = group[0] as Word
    if (group.length === 1) {
      lines.push(first)
      continue
    }
    const ordered = [...group].sort((a, b) => project(first.rect, a.rect).u - project(first.rect, b.rect).u)
    // The line follows the words' own reading angle; a min-area rectangle of the word boxes can tilt
    // by a few degrees, which clips ascenders when the line is cropped upright.
    const angle = ordered.reduce((sum, w) => sum + w.rect.angle, 0) / ordered.length
    const merged = rectAtAngle(
      ordered.flatMap((w) => rectCorners(w.rect)),
      angle
    )
    const chars = ordered.reduce((sum, w) => sum + w.text.length, 0)
    lines.push({
      text: ordered.map((w) => w.text).join(' '),
      words: ordered.length,
      confidence: ordered.reduce((s, w) => s + w.confidence * w.text.length, 0) / Math.max(1, chars),
      rect: merged
    })
  }
  return lines.sort((a, b) =>
    Math.abs(a.rect.cy - b.rect.cy) < Math.min(a.rect.height, b.rect.height) / 2
      ? a.rect.cx - b.rect.cx
      : a.rect.cy - b.rect.cy
  )
}
