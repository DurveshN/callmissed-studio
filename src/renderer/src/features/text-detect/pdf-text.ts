import type { Page, StudioDocument, TextLayer } from '@shared/document/model'
import { rectCorners, type RotatedRect } from '@shared/geometry/rotated-rect'
import { pdfTextRuns } from '../assets/pdf'
import { measureTextHeight, textLayout } from '../canvas/text-metrics'
import { TEXT_LINE_HEIGHT } from '../fonts/font-match-protocol'
import type { RasterSnapshot } from '../raster/raster-target'
import type { DetectedLine } from './detect-store'
import { groupRuns, inkColor, parsePdfFont, runBox } from './pdf-runs'

/** The text of a PDF line as the PDF states it: font, size and baseline (raster pixels). */
export interface NativeText {
  family: string
  weight: number
  italic: boolean
  size: number
  x: number
  y: number
  angle: number
}

const NO_MASK = { width: 1, height: 1, data: new Uint8Array(1) }

/**
 * The page's own text as detected lines (exact words, font, size and baseline from the PDF), or
 * null when the page is not a PDF page or has no text (a scan: use OCR). Lines under a patch were
 * already edited and are left out.
 */
export async function nativeLines(
  doc: StudioDocument,
  page: Page,
  snap: RasterSnapshot
): Promise<DetectedLine[] | null> {
  if (page.background.kind !== 'pdf') return null
  const { runs, fonts } = await pdfTextRuns(doc.id, doc.source.assetId, page.background.pageIndex)
  const lines = groupRuns(runs)
  if (lines.length === 0) return null
  const patched = (rect: RotatedRect) =>
    page.patches.some(
      (p) => rect.cx >= p.x && rect.cx <= p.x + p.width && rect.cy >= p.y && rect.cy <= p.y + p.height
    )
  return lines.flatMap((line): DetectedLine[] => {
    const rect = runBox(line)
    if (patched(rect)) return []
    const font = fonts.get(line.font)
    const style = parsePdfFont(font?.name ?? '', { serif: !!font?.serif, mono: !!font?.mono })
    const { color, background } = inkColor(snap.image, rect)
    return [
      {
        id: crypto.randomUUID(),
        text: line.text,
        confidence: 1,
        rect,
        corners: rectCorners(rect).map(snap.toPage),
        style: { color, background, inkTop: 0, inkBottom: rect.height, strokeWidth: 0 },
        mask: NO_MASK,
        handwriting: false,
        native: { ...style, size: line.size, x: line.x, y: line.y, angle: line.angle }
      }
    ]
  })
}

/** A text layer whose first baseline lies exactly on the PDF line's baseline. */
export function nativeTextLayer(line: DetectedLine, native: NativeText, snap: RasterSnapshot): TextLayer {
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
    fontFamily: native.family,
    fontSize,
    fontWeight: native.weight,
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
