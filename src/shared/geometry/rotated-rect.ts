export interface RotatedRect {
  cx: number
  cy: number
  /** Side along the text direction. */
  width: number
  height: number
  /** Degrees, clockwise in image coordinates. */
  angle: number
}

export interface Point {
  x: number
  y: number
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
