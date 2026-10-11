export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Guide {
  orientation: 'vertical' | 'horizontal'
  /** Position in page coordinates. */
  at: number
}

export interface SnapResult {
  dx: number
  dy: number
  guides: Guide[]
}

const stops = (r: Rect, axis: 'x' | 'y'): number[] =>
  axis === 'x' ? [r.x, r.x + r.width / 2, r.x + r.width] : [r.y, r.y + r.height / 2, r.y + r.height]

function snapAxis(moving: Rect, targets: Rect[], axis: 'x' | 'y', threshold: number) {
  let best: { delta: number; at: number } | null = null
  for (const target of targets) {
    for (const want of stops(target, axis)) {
      for (const have of stops(moving, axis)) {
        const delta = want - have
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, at: want }
        }
      }
    }
  }
  return best
}

/**
 * Offset that aligns `moving`'s edges/center with the closest edge/center of any target
 * (the page itself is passed as a target), within `threshold` page units.
 */
export function snap(moving: Rect, targets: Rect[], threshold: number): SnapResult {
  const x = snapAxis(moving, targets, 'x', threshold)
  const y = snapAxis(moving, targets, 'y', threshold)
  const guides: Guide[] = []
  if (x) guides.push({ orientation: 'vertical', at: x.at })
  if (y) guides.push({ orientation: 'horizontal', at: y.at })
  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, guides }
}
