import type { RotatedRect } from '../../image/geometry'
import { inkDistances, inkPixels } from '../../image/ink'
import { dilate } from '../../image/morphology'
import type { Gray, Rgba } from '../../image/raster'

/** Above this share of ink, a box is treated as solid (e.g. text on a busy photo) and erased whole. */
const SOLID_RATIO = 0.6
/** Erase masks use half the Otsu contrast threshold (see textMask). */
const ERASE_THRESHOLD = 0.5

/**
 * Mask of the text strokes inside each rectangle, slightly dilated so anti-aliased edges and
 * shadows are erased too. Only ink is masked so textured backgrounds around letters survive.
 */
export function textMask(img: Rgba, rects: RotatedRect[]): Gray {
  const mask: Gray = { width: img.width, height: img.height, data: new Uint8Array(img.width * img.height) }
  let dilation = 3
  for (const rect of rects) {
    // Generous: photographed strokes have soft halos; leaving them unmasked makes the fill copy their
    // grey back in (ghost letters).
    const ink = inkPixels(img, rect, 'rules', 12, rect, ERASE_THRESHOLD)
    const area = Math.max(1, rect.width * rect.height)
    if (ink.indices.length / area > SOLID_RATIO) {
      // Busy background: erase the whole box rather than a noisy stroke mask.
      for (const i of inkDistances(img, rect).indices) mask.data[i] = 255
    } else {
      for (const i of ink.indices) mask.data[i] = 255
    }
    dilation = Math.max(dilation, Math.round(rect.height * 0.12))
  }
  return dilate(mask, dilation)
}
