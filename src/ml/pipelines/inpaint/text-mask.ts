import type { RotatedRect } from '../../image/geometry'
import { inkDistances, inkPixels } from '../../image/ink'
import { dilate } from '../../image/morphology'
import type { Gray, Rgba } from '../../image/raster'

/** Above this share of ink, a box is treated as solid (e.g. text on a busy photo) and erased whole. */
const SOLID_RATIO = 0.6

/**
 * Mask of the text strokes inside each rectangle, slightly dilated so anti-aliased edges and
 * shadows are erased too. Only ink is masked so textured backgrounds around letters survive.
 */
export function textMask(img: Rgba, rects: RotatedRect[]): Gray {
  const mask: Gray = { width: img.width, height: img.height, data: new Uint8Array(img.width * img.height) }
  let dilation = 2
  for (const rect of rects) {
    const ink = inkPixels(img, rect, true, 20)
    const area = Math.max(1, rect.width * rect.height)
    if (ink.indices.length / area > SOLID_RATIO) {
      // Busy background: erase the whole box rather than a noisy stroke mask.
      for (const i of inkDistances(img, rect).indices) mask.data[i] = 255
    } else {
      for (const i of ink.indices) mask.data[i] = 255
    }
    dilation = Math.max(dilation, Math.round(rect.height * 0.06))
  }
  return dilate(mask, dilation)
}
