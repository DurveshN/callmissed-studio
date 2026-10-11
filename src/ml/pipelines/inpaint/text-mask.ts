import { containsPoint, rectCorners, type RotatedRect } from '../../image/geometry'
import { dilate, otsu } from '../../image/morphology'
import type { Gray, Rgba } from '../../image/raster'

/** Above this share of ink, a box is treated as solid (e.g. text on a busy photo) and erased whole. */
const SOLID_RATIO = 0.6

/**
 * Mask of the text strokes inside each rectangle, slightly dilated so anti-aliased edges and
 * shadows are erased too. Only ink is masked so textured backgrounds around letters survive.
 */
export function textMask(img: Rgba, rects: RotatedRect[]): Gray {
  const { width, height, data } = img
  const mask: Gray = { width, height, data: new Uint8Array(width * height) }
  let dilation = 2

  for (const rect of rects) {
    const corners = rectCorners(rect)
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))))
    const x1 = Math.min(width - 1, Math.ceil(Math.max(...corners.map((c) => c.x))))
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))))
    const y1 = Math.min(height - 1, Math.ceil(Math.max(...corners.map((c) => c.y))))
    const inner = { ...rect, width: Math.max(0, rect.width - 4), height: Math.max(0, rect.height - 4) }

    // Background color from the band between the box edge and a slightly smaller box.
    const ring: [number[], number[], number[]] = [[], [], []]
    const inside: number[] = []
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!containsPoint(rect, x + 0.5, y + 0.5)) continue
        const i = y * width + x
        inside.push(i)
        if (!containsPoint(inner, x + 0.5, y + 0.5)) {
          ring[0].push(data[i * 4] as number)
          ring[1].push(data[i * 4 + 1] as number)
          ring[2].push(data[i * 4 + 2] as number)
        }
      }
    }
    if (inside.length === 0) continue
    const bg = ring.map((c) => [...c].sort((a, b) => a - b)[Math.floor(c.length / 2)] ?? 0)
    const distances = inside.map((i) =>
      Math.min(
        255,
        Math.round(
          Math.hypot(
            (data[i * 4] as number) - (bg[0] as number),
            (data[i * 4 + 1] as number) - (bg[1] as number),
            (data[i * 4 + 2] as number) - (bg[2] as number)
          ) / Math.sqrt(3)
        )
      )
    )
    const threshold = Math.max(20, otsu(distances))
    const ink = distances.filter((d) => d > threshold).length
    const solid = ink / inside.length > SOLID_RATIO
    inside.forEach((i, k) => {
      if (solid || (distances[k] as number) > threshold) mask.data[i] = 255
    })
    dilation = Math.max(dilation, Math.round(rect.height * 0.06))
  }
  return dilate(mask, dilation)
}
