import { rectAtAngle, type RotatedRect } from '../../image/geometry'
import { inkPixels } from '../../image/ink'
import type { Point, Rgba } from '../../image/raster'

const SEARCH_DEGREES = 5
const STEP_DEGREES = 0.25
/** Fitting looks this much beyond the box (fraction of its height) to recover clipped ascenders. */
const FIT_MARGIN = 0.12

function inkPoints(src: Rgba, rect: RotatedRect, sampleRect?: RotatedRect): Point[] {
  return inkPixels(src, rect, sampleRect !== undefined, 24, sampleRect ?? rect).indices.map((i) => ({
    x: (i % src.width) + 0.5,
    y: Math.floor(i / src.width) + 0.5
  }))
}

/** Angle near `start` whose cross-line projection profile is sharpest (rows of text line up). */
function deskew(points: Point[], start: number): number {
  let best = start
  let bestScore = -Infinity
  for (let delta = -SEARCH_DEGREES; delta <= SEARCH_DEGREES + 1e-9; delta += STEP_DEGREES) {
    const angle = start + delta
    const rad = (angle * Math.PI) / 180
    const sin = Math.sin(rad)
    const cos = Math.cos(rad)
    const rows = new Map<number, number>()
    for (const p of points) {
      const v = Math.round(-p.x * sin + p.y * cos)
      rows.set(v, (rows.get(v) ?? 0) + 1)
    }
    let score = 0
    for (const count of rows.values()) score += count * count
    // On ties (very short lines) keep the detector's angle.
    score -= Math.abs(delta) * 1e-6
    if (score > bestScore) {
      bestScore = score
      best = angle
    }
  }
  return best
}

/**
 * Refines a detected line from its ink. Detection boxes of short words are often a few degrees off,
 * which tilts the upright crop, clips ascenders and skews font matching. Pass 1 estimates the exact
 * angle from ink inside the detected box (projection-profile deskew); pass 2 re-fits the box at that
 * angle, looking slightly beyond it for ink the tilted box had cut off.
 */
export function refineLine(src: Rgba, rect: RotatedRect): RotatedRect {
  const inside = inkPoints(src, rect)
  if (inside.length < 20) return rect
  const angle = deskew(inside, rect.angle)
  const turned = { ...rect, angle }
  // Scan a little beyond the box, but keep sampling background inside it (the area outside may be
  // a different surface, e.g. beyond a banner's edge).
  const points = inkPoints(
    src,
    {
      ...turned,
      width: rect.width + rect.height * FIT_MARGIN * 2,
      height: rect.height * (1 + FIT_MARGIN * 2)
    },
    turned
  )
  if (points.length < 20) return turned
  const fitted = rectAtAngle(points, angle)
  const pad = Math.max(2, fitted.height * 0.15)
  return { ...fitted, width: fitted.width + 2 * pad, height: fitted.height + 2 * pad }
}
