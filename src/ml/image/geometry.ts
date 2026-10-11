import type { Point } from './raster'

export interface RotatedRect {
  cx: number
  cy: number
  /** Side along the text direction (always >= height). */
  width: number
  height: number
  /** Degrees, clockwise in image coordinates, in (-90, 90]. */
  angle: number
}

export interface Component {
  /** Pixel indices belonging to the component. */
  pixels: Int32Array
  /** Boundary pixel coordinates (enough to compute the convex hull). */
  boundary: Point[]
}

/** 4-connected components of `mask` (non-zero = foreground), in scan order. */
export function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minPixels = 1
): Component[] {
  const labels = new Int32Array(width * height)
  const stack = new Int32Array(width * height)
  const out: Component[] = []
  let next = 0
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue
    next++
    let top = 0
    stack[top++] = start
    labels[start] = next
    const pixels: number[] = []
    const boundary: Point[] = []
    while (top > 0) {
      const i = stack[--top] as number
      pixels.push(i)
      const x = i % width
      const y = (i - x) / width
      let edge = false
      const visit = (j: number, inside: boolean) => {
        if (!inside || !mask[j]) {
          edge = true
          return
        }
        if (!labels[j]) {
          labels[j] = next
          stack[top++] = j
        }
      }
      visit(i - 1, x > 0)
      visit(i + 1, x < width - 1)
      visit(i - width, y > 0)
      visit(i + width, y < height - 1)
      if (edge) boundary.push({ x, y })
    }
    if (pixels.length >= minPixels) out.push({ pixels: Int32Array.from(pixels), boundary })
  }
  return out
}

/** Convex hull (Andrew's monotone chain), counter-clockwise, without collinear points. */
export function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return [...points]
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const build = (list: Point[]) => {
    const hull: Point[] = []
    for (const p of list) {
      while (
        hull.length >= 2 &&
        cross(hull[hull.length - 2] as Point, hull[hull.length - 1] as Point, p) <= 0
      )
        hull.pop()
      hull.push(p)
    }
    hull.pop()
    return hull
  }
  return [...build(sorted), ...build([...sorted].reverse())]
}

/**
 * Minimum-area enclosing rectangle via rotating calipers over hull edges.
 * Points are pixel coordinates; the rectangle covers whole pixels (+1 extent).
 */
export function minAreaRect(points: Point[]): RotatedRect {
  const hull = convexHull(points)
  if (hull.length === 0) return { cx: 0, cy: 0, width: 0, height: 0, angle: 0 }
  if (hull.length < 3) {
    const xs = hull.map((p) => p.x)
    const ys = hull.map((p) => p.y)
    return normalize({
      cx: (Math.min(...xs) + Math.max(...xs) + 1) / 2,
      cy: (Math.min(...ys) + Math.max(...ys) + 1) / 2,
      width: Math.max(...xs) - Math.min(...xs) + 1,
      height: Math.max(...ys) - Math.min(...ys) + 1,
      angle: 0
    })
  }

  // Pixel squares, not pixel centers: include all four corners of each hull pixel.
  const corners = convexHull(
    hull.flatMap((p) => [p, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x + 1, y: p.y + 1 }])
  )
  let best: RotatedRect | null = null
  let bestArea = Infinity
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i] as Point
    const b = corners[(i + 1) % corners.length] as Point
    const theta = Math.atan2(b.y - a.y, b.x - a.x)
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const p of corners) {
      const u = p.x * cos + p.y * sin
      const v = -p.x * sin + p.y * cos
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const area = (maxU - minU) * (maxV - minV)
    if (area < bestArea - 1e-9) {
      bestArea = area
      const cu = (minU + maxU) / 2
      const cv = (minV + maxV) / 2
      best = {
        cx: cu * cos - cv * sin,
        cy: cu * sin + cv * cos,
        width: maxU - minU,
        height: maxV - minV,
        angle: (theta * 180) / Math.PI
      }
    }
  }
  return normalize(best as RotatedRect)
}

/** Makes width the longer side and keeps the angle in (-90, 90]. */
export function normalize(rect: RotatedRect): RotatedRect {
  let { width, height, angle } = rect
  if (height > width) {
    ;[width, height] = [height, width]
    angle += 90
  }
  while (angle > 90) angle -= 180
  while (angle <= -90) angle += 180
  // Prefer a horizontal reading for near-axis rectangles (avoids ±90° flips on squares).
  if (Math.abs(Math.abs(angle) - 90) < 1e-6 && Math.abs(width - height) < 1e-6) angle = 0
  return { cx: rect.cx, cy: rect.cy, width, height, angle }
}

/** Corners as top-left, top-right, bottom-right, bottom-left along the rectangle's own axes. */
export function rectCorners(rect: RotatedRect): Point[] {
  const rad = (rect.angle * Math.PI) / 180
  const ux = Math.cos(rad)
  const uy = Math.sin(rad)
  const hw = rect.width / 2
  const hh = rect.height / 2
  const at = (su: number, sv: number): Point => ({
    x: rect.cx + su * hw * ux - sv * hh * uy,
    y: rect.cy + su * hw * uy + sv * hh * ux
  })
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)]
}

/** Grows a rectangle like PaddleOCR's unclip: offset distance = area * ratio / perimeter on every side. */
export function unclip(rect: RotatedRect, ratio: number): RotatedRect {
  const perimeter = 2 * (rect.width + rect.height)
  if (perimeter === 0) return rect
  const d = (rect.width * rect.height * ratio) / perimeter
  return { ...rect, width: rect.width + 2 * d, height: rect.height + 2 * d }
}

export function scaleRect(rect: RotatedRect, sx: number, sy: number): RotatedRect {
  // Non-uniform scale of a rotated rect is approximated by scaling its corners and refitting.
  if (Math.abs(sx - sy) < 1e-9) {
    return { ...rect, cx: rect.cx * sx, cy: rect.cy * sy, width: rect.width * sx, height: rect.height * sy }
  }
  const corners = rectCorners(rect).map((p) => ({ x: p.x * sx, y: p.y * sy }))
  const [tl, tr, , bl] = corners as [Point, Point, Point, Point]
  return normalize({
    cx: rect.cx * sx,
    cy: rect.cy * sy,
    width: Math.hypot(tr.x - tl.x, tr.y - tl.y),
    height: Math.hypot(bl.x - tl.x, bl.y - tl.y),
    angle: (Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI
  })
}

/** Whether a point lies inside a rotated rectangle. */
export function containsPoint(rect: RotatedRect, x: number, y: number): boolean {
  const rad = (-rect.angle * Math.PI) / 180
  const dx = x - rect.cx
  const dy = y - rect.cy
  const u = dx * Math.cos(rad) - dy * Math.sin(rad)
  const v = dx * Math.sin(rad) + dy * Math.cos(rad)
  return Math.abs(u) <= rect.width / 2 && Math.abs(v) <= rect.height / 2
}
