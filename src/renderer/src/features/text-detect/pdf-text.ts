import type { Page, StudioDocument, TextLayer } from '@shared/document/model'
import { rectCorners, type RotatedRect } from '@shared/geometry/rotated-rect'
import { pdfTextRuns } from '../assets/pdf'
import { measureTextHeight, textLayout } from '../canvas/text-metrics'
import { TEXT_LINE_HEIGHT } from '../fonts/font-match-protocol'
import type { RasterSnapshot } from '../raster/raster-target'
import type { DetectedLine } from './detect-store'
import { isFontInstalled } from '../fonts/installed'
import { groupRuns, inkColor, parsePdfFont, runBox } from './pdf-runs'

/** The text of a PDF line as the PDF states it: font, size and baseline (raster pixels). */
export interface NativeText {
  family: string
  weight: number
  italic: boolean
  /** The editor has the PDF's family; otherwise the closest font is matched from the pixels. */
  known: boolean
  size: number
  x: number
  y: number
  angle: number
}

const NO_MASK = { width: 1, height: 1, data: new Uint8Array(1) }

/**
 * Ink coverage (0..255) of the upright crop of `rect`: how far each pixel is from the background
 * colour, for matching the closest font to text in a family the editor doesn't have.
 */
function lineMask(source: OffscreenCanvas, rect: RotatedRect, background: string) {
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })
  if (!ctx) return NO_MASK
  ctx.translate(width / 2, height / 2)
  ctx.rotate((-rect.angle * Math.PI) / 180)
  ctx.translate(-rect.cx, -rect.cy)
  ctx.drawImage(source, 0, 0)
  const { data } = ctx.getImageData(0, 0, width, height)
  const bg = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16)) as [number, number, number]
  const distances = new Float32Array(width * height)
  let strongest = 0
  for (let i = 0; i < distances.length; i++) {
    const d = Math.hypot(
      (data[i * 4] as number) - bg[0],
      (data[i * 4 + 1] as number) - bg[1],
      (data[i * 4 + 2] as number) - bg[2]
    )
    distances[i] = d
    strongest = Math.max(strongest, d)
  }
  // Soft coverage like the recognizer's masks: faint halo out, full strokes at 255.
  const mask = new Uint8Array(width * height)
  const lo = Math.max(30, strongest * 0.15)
  const hi = Math.max(lo + 1, strongest * 0.7)
  for (let i = 0; i < mask.length; i++) {
    const d = distances[i] as number
    if (d > lo) mask[i] = Math.min(255, Math.round((255 * (d - lo)) / (hi - lo)))
  }
  return { width, height, data: mask }
}

/**
 * The page's own text as detected lines (exact words, font, size and baseline from the PDF), and
 * whether the page also draws pictures (whose text only recognition can read). Null when the page
 * is not a PDF page or has no text (a scan: use OCR). Lines under a patch were already edited and
 * are left out.
 */
export async function nativeLines(
  doc: StudioDocument,
  page: Page,
  snap: RasterSnapshot
): Promise<{ lines: DetectedLine[]; hasImages: boolean } | null> {
  if (page.background.kind !== 'pdf') return null
  const { runs, fonts, hasImages } = await pdfTextRuns(doc.id, doc.source.assetId, page.background.pageIndex)
  const lines = groupRuns(runs)
  if (lines.length === 0) return null
  const patched = (rect: RotatedRect) =>
    page.patches.some(
      (p) => rect.cx >= p.x && rect.cx <= p.x + p.width && rect.cy >= p.y && rect.cy <= p.y + p.height
    )
  let source: OffscreenCanvas | null = null
  const detected = lines.flatMap((line): DetectedLine[] => {
    const rect = runBox(line)
    if (patched(rect)) return []
    const { color, background, inked } = inkColor(snap.image, rect)
    // No ink: invisible text (an OCR layer over a blank area, white on white) has nothing to edit.
    if (!inked) return []
    const font = fonts.get(line.font)
    const parsed = parsePdfFont(font?.name ?? '', { serif: !!font?.serif, mono: !!font?.mono })
    // A family outside the catalog but installed on this PC (e.g. Comic Sans MS) is used as it is.
    const style =
      !parsed.known && parsed.pdfFamily && isFontInstalled(parsed.pdfFamily)
        ? { ...parsed, family: parsed.pdfFamily, known: true }
        : parsed
    let mask = NO_MASK
    if (!style.known) {
      if (!source) {
        source = new OffscreenCanvas(snap.image.width, snap.image.height)
        source.getContext('2d')?.putImageData(snap.image, 0, 0)
      }
      mask = lineMask(source, rect, background)
    }
    return [
      {
        id: crypto.randomUUID(),
        text: line.text,
        confidence: 1,
        rect,
        corners: rectCorners(rect).map(snap.toPage),
        style: { color, background, inkTop: 0, inkBottom: rect.height, strokeWidth: 0 },
        mask,
        handwriting: false,
        native: {
          family: style.family,
          weight: style.weight,
          italic: style.italic,
          known: style.known,
          size: line.size,
          x: line.x,
          y: line.y,
          angle: line.angle
        }
      }
    ]
  })
  return { lines: detected, hasImages }
}

/** A text layer whose first baseline lies exactly on the PDF line's baseline. */
export function nativeTextLayer(
  line: DetectedLine,
  native: NativeText,
  snap: RasterSnapshot,
  /** For families the editor doesn't have: the font matched from the pixels. */
  matched: { family: string; weight: number } | null
): TextLayer {
  const face = !native.known && matched ? matched : native
  const fontSize = native.size * snap.scale
  const layer: TextLayer = {
    id: crypto.randomUUID(),
    type: 'text',
    name: line.text.length > 40 ? `${line.text.slice(0, 40)}…` : line.text,
    visible: true,
    locked: false,
    opacity: 1,
    x: 0,
    y: 0,
    width: 10_000,
    height: 0,
    rotation: native.angle + snap.rotation,
    text: line.text,
    fontFamily: face.family,
    fontSize,
    fontWeight: face.weight,
    italic: native.italic,
    color: line.style.color,
    align: 'left',
    lineHeight: TEXT_LINE_HEIGHT,
    origin: 'pdf-native'
  }
  // Konva puts the first baseline `baseline` below the box top: move the box up by that, across the text.
  const { baseline, lines } = textLayout(layer)
  const rad = ((native.angle + snap.rotation) * Math.PI) / 180
  const start = snap.toPage({ x: native.x, y: native.y })
  const width = (lines[0]?.width ?? 0) * 1.04 + fontSize * 0.5
  const placed = {
    ...layer,
    x: start.x + baseline * Math.sin(rad),
    y: start.y - baseline * Math.cos(rad),
    width
  }
  return { ...placed, height: measureTextHeight(placed) }
}
