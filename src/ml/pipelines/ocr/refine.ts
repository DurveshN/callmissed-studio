import { connectedComponents, rectAtAngle, type RotatedRect } from '../../image/geometry'
import { inkPixels } from '../../image/ink'
import type { Point, Rgba } from '../../image/raster'

const SEARCH_DEGREES = 5
const STEP_DEGREES = 0.25
/** Fitting looks this much beyond the box (fraction of its height) to recover clipped ascenders. */
const FIT_MARGIN = 0.12

function inkPoints(src: Rgba, rect: RotatedRect, sampleRect?: RotatedRect): Point[] {
  return inkPixels(src, rect, sampleRect ? 'glyphs' : 'none', 24, sampleRect ?? rect).indices.map((i) => ({
    x: (i % src.width) + 0.5,
    y: Math.floor(i / src.width) + 0.5
  }))
}

/** Half-height (share of the box) of the band around the line's centre its own glyphs must reach. */
const CORE_BAND = 0.15

/**
 * Keeps the ink components that reach the band around the line's centre. Detection boxes of large
 * text can overlap the neighbouring line; its letters are separate components that never reach this
 * line's centre, while this line's ascenders and descenders are attached to letters that do.
 */
function ownComponents(points: Point[], rect: RotatedRect): Point[] {
  if (points.length === 0) return points
  const xs = points.map((p) => Math.floor(p.x))
  const ys = points.map((p) => Math.floor(p.y))
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const w = Math.max(...xs) - x0 + 1
  const h = Math.max(...ys) - y0 + 1
  const grid = new Uint8Array(w * h)
  points.forEach((_, i) => (grid[((ys[i] as number) - y0) * w + (xs[i] as number) - x0] = 1))
  const rad = (rect.angle * Math.PI) / 180
  const sin = Math.sin(rad)
  const cos = Math.cos(rad)
  const band = rect.height * CORE_BAND
  const components = connectedComponents(grid, w, h).map((component) => {
    const pts = Array.from(component.pixels, (j) => ({
      x: (j % w) + x0 + 0.5,
      y: Math.floor(j / w) + y0 + 0.5
    }))
    const vs = pts.map((p) => -(p.x - rect.cx) * sin + (p.y - rect.cy) * cos)
    return { pts, top: Math.min(...vs), bottom: Math.max(...vs) }
  })
  // Tier 1: letters reaching the centre band define the line's vertical extent.
  const core = components.filter((c) => c.top <= band && c.bottom >= -band)
  if (core.length === 0) return []
  const top = Math.min(...core.map((c) => c.top))
  const bottom = Math.max(...core.map((c) => c.bottom))
  // Tier 2: small marks lying entirely within that extent (periods, commas, i-dots) belong to it too;
  // a neighbouring line's letters stick out of it.
  return components
    .filter((c) => core.includes(c) || (c.top >= top && c.bottom <= bottom))
    .flatMap((c) => c.pts)
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
  const own = ownComponents(points, turned)
  if (own.length < 20) return turned
  const fitted = rectAtAngle(own, angle)
  const pad = Math.max(2, fitted.height * 0.15)
  return { ...fitted, width: fitted.width + 2 * pad, height: fitted.height + 2 * pad }
}
