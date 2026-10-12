import type { ImageLayer } from '@shared/document/model'
import { rectCorners, type Point } from '@shared/geometry/rotated-rect'
import { newImageLayer } from '../document/factories'
import { writeAsset } from '../raster/raster-edit'
import { encodePng, type RasterSnapshot } from '../raster/raster-target'
import type { DetectedLine } from './detect-store'

function context(width: number, height: number): OffscreenCanvasRenderingContext2D {
  const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D is unavailable')
  return ctx
}

/**
 * Image layers holding just the ink of `lines` (signatures, handwriting) on a transparent background,
 * placed exactly over the originals. The ink is each line's soft coverage mask from detection.
 */
export async function liftedLayers(
  docId: string,
  snap: RasterSnapshot,
  lines: DetectedLine[]
): Promise<ImageLayer[]> {
  const source = context(snap.image.width, snap.image.height)
  source.putImageData(snap.image, 0, 0)
  const layers: ImageLayer[] = []
  for (const [n, line] of lines.entries()) {
    const { width, height, data: mask } = line.mask
    // Upright crop of the line's (rotated) box: the pixels detection measured the mask on.
    const crop = context(width, height)
    crop.translate(width / 2, height / 2)
    crop.rotate((-line.rect.angle * Math.PI) / 180)
    crop.translate(-line.rect.cx, -line.rect.cy)
    crop.drawImage(source.canvas, 0, 0)
    const pixels = crop.getImageData(0, 0, width, height)
    for (let i = 0; i < mask.length; i++) {
      pixels.data[i * 4 + 3] = Math.round(((pixels.data[i * 4 + 3] as number) * (mask[i] as number)) / 255)
    }
    const assetId = await writeAsset(docId, await encodePng(pixels.data, width, height))
    const [tl, tr, , bl] = rectCorners(line.rect).map(snap.toPage) as [Point, Point, Point, Point]
    layers.push(
      newImageLayer(
        assetId,
        lines.length > 1 ? `Handwriting ${n + 1}` : 'Handwriting',
        {
          x: tl.x,
          y: tl.y,
          width: Math.hypot(tr.x - tl.x, tr.y - tl.y),
          height: Math.hypot(bl.x - tl.x, bl.y - tl.y),
          rotation: line.rect.angle + snap.rotation
        },
        'cutout'
      )
    )
  }
  return layers
}
