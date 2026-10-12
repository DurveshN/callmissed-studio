import type { Draft } from 'immer'
import type { Layer, StudioDocument, TextLayer } from '@shared/document/model'
import { rectCorners, type Point, type RotatedRect } from '@shared/geometry/rotated-rect'
import { notify } from '../../ui/notify'
import { measureTextHeight } from '../canvas/text-metrics'
import { DEFAULT_FONT } from '../fonts/catalog'
import { chooseFonts } from '../fonts/font-consensus'
import { matchFont } from '../fonts/font-match'
import { TEXT_LINE_HEIGHT, type FontCandidate, type FontMatchResult } from '../fonts/font-match-protocol'
import { MlError, runJob } from '../ml/ml-client'
import { ensureModel } from '../models/ensure-model'
import { useModelsStore } from '../models/models-store'
import { selectActivePage, useDocumentStore } from '../document/store'
import { writeRaster } from '../raster/raster-edit'
import { cropPixels, currentTarget, snapshot, type RasterSnapshot } from '../raster/raster-target'
import { looksHandwritten } from './classify'
import { getSnapshot, resetDetect, setSnapshot, useDetectStore, type DetectedLine } from './detect-store'

let abort: AbortController | null = null
let eraserTipShown = false

/** Runs OCR on the selected image layer, or on the page if no image layer is selected. */
export async function detectText(): Promise<void> {
  const state = useDocumentStore.getState()
  const page = selectActivePage(state)
  if (!state.doc || !page) return
  cancelDetect()
  const target = currentTarget(page, state.selection)
  useDetectStore.setState({ status: 'preparing', target, progress: 0, lines: [], message: null })
  try {
    const ready = await ensureModel('ocr', 'Detecting text', (progress) =>
      useDetectStore.setState({
        status: 'preparing',
        progress,
        message: 'Downloading the text detection model…'
      })
    )
    if (!ready) return resetDetect()
    const snap = await snapshot(state.doc, target)
    setSnapshot(snap)
    useDetectStore.setState({ status: 'detecting', progress: 0, message: null })
    abort = new AbortController()
    const { image } = snap
    const result = await runJob(
      'ocr',
      { width: image.width, height: image.height, pixels: new Uint8Array(image.data.buffer.slice(0)) },
      { signal: abort.signal, onProgress: (progress) => useDetectStore.setState({ progress }) }
    )
    const detected: DetectedLine[] = result.lines.map((line) => ({
      ...line,
      id: crypto.randomUUID(),
      corners: rectCorners(line.rect).map(snap.toPage),
      handwriting: false
    }))
    // Font matching tells printed text from handwriting, so finish it before showing results.
    useDetectStore.setState({ message: 'Analyzing fonts…', progress: 1 })
    const fonts = await Promise.all(detected.map(matchFor))
    if (abort.signal.aborted) return
    const lines = detected.map((line, i) => ({
      ...line,
      handwriting: looksHandwritten(line.confidence, fonts[i] ?? null)
    }))
    useDetectStore.setState({
      status: 'ready',
      lines,
      provider: result.provider,
      message: lines.length ? null : 'No text found here.'
    })
  } catch (error) {
    if (error instanceof MlError && error.code === 'CANCELLED') return
    useDetectStore.setState({
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  } finally {
    abort = null
  }
}

export function cancelDetect(): void {
  abort?.abort()
  matches.clear()
  resetDetect()
}

/** Font matches per detected line (computed once, in the font worker). */
const matches = new Map<string, Promise<FontMatchResult | null>>()

function matchFor(line: DetectedLine): Promise<FontMatchResult | null> {
  let pending = matches.get(line.id)
  if (!pending) {
    pending = matchFont({
      text: line.text,
      mask: line.mask.data,
      width: line.mask.width,
      height: line.mask.height
    }).catch((error: unknown) => {
      console.error('Font matching failed', error)
      return null
    })
    matches.set(line.id, pending)
  }
  return pending
}

/**
 * Fonts for `targets`, chosen consistently with every detected line of the same style
 * (see chooseFonts), not just the lines being converted now.
 */
async function fontsFor(
  targets: DetectedLine[],
  snap: RasterSnapshot
): Promise<Map<string, FontCandidate | null>> {
  const all = useDetectStore.getState().lines
  const results = await Promise.all(all.map(matchFor))
  const chosen = chooseFonts(
    all.map((line, i) => ({
      id: line.id,
      scale: snap.scale,
      color: line.style.color,
      match: results[i] ?? null
    }))
  )
  return new Map(targets.map((t) => [t.id, chosen.get(t.id) ?? null]))
}

/** Source-pixel regions around groups of nearby lines (each region becomes one inpainting job / patch). */
export function lineRegions(lines: { rect: RotatedRect }[], width: number, height: number) {
  type Region = { x0: number; y0: number; x1: number; y1: number; members: number[] }
  const regions: Region[] = lines.map((line, i) => {
    const pts = rectCorners(line.rect)
    const margin = Math.max(12, Math.round(line.rect.height * 0.6))
    return {
      x0: Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x))) - margin),
      y0: Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y))) - margin),
      x1: Math.min(width, Math.ceil(Math.max(...pts.map((p) => p.x))) + margin),
      y1: Math.min(height, Math.ceil(Math.max(...pts.map((p) => p.y))) + margin),
      members: [i]
    }
  })
  // Merge overlapping regions until stable.
  for (let merged = true; merged;) {
    merged = false
    for (let i = 0; i < regions.length && !merged; i++) {
      for (let j = i + 1; j < regions.length && !merged; j++) {
        const a = regions[i] as Region
        const b = regions[j] as Region
        if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
          regions[i] = {
            x0: Math.min(a.x0, b.x0),
            y0: Math.min(a.y0, b.y0),
            x1: Math.max(a.x1, b.x1),
            y1: Math.max(a.y1, b.y1),
            members: [...a.members, ...b.members]
          }
          regions.splice(j, 1)
          merged = true
        }
      }
    }
  }
  return regions.map((r) => ({
    x: r.x0,
    y: r.y0,
    width: r.x1 - r.x0,
    height: r.y1 - r.y0,
    members: r.members
  }))
}

let measureCtx: OffscreenCanvasRenderingContext2D | null = null
function textWidth(text: string, family: string, weight: number, size: number): number {
  measureCtx ??= new OffscreenCanvas(1, 1).getContext('2d')
  if (!measureCtx) return text.length * size * 0.6
  measureCtx.font = `${weight} ${size}px "${family}"`
  return measureCtx.measureText(text).width
}

/** An editable text layer that reproduces `line` on the page, using the matched font when one fits. */
function textLayerFor(line: DetectedLine, snap: RasterSnapshot, match: FontCandidate | null): TextLayer {
  const family = match?.family ?? DEFAULT_FONT
  const weight =
    match?.weight ??
    (line.style.strokeWidth / Math.max(1, line.style.inkBottom - line.style.inkTop) > 0.12 ? 700 : 400)
  // Without a match, approximate the size from the ink height (cap height ≈ 0.72 em).
  const cropSize = match?.fontSize ?? Math.max(4, (line.style.inkBottom - line.style.inkTop) / 0.72)
  const offset: Point = match
    ? { x: match.inkLeft, y: match.inkTop }
    : { x: 0, y: line.style.inkTop - cropSize * 0.25 }

  const [tl, tr, , bl] = rectCorners(line.rect) as [Point, Point, Point, Point]
  const u = { x: (tr.x - tl.x) / line.rect.width, y: (tr.y - tl.y) / line.rect.width }
  const v = { x: (bl.x - tl.x) / line.rect.height, y: (bl.y - tl.y) / line.rect.height }
  const origin = snap.toPage({
    x: tl.x + offset.x * u.x + offset.y * v.x,
    y: tl.y + offset.x * u.y + offset.y * v.y
  })
  const fontSize = cropSize * snap.scale
  const width = textWidth(line.text, family, weight, fontSize) * 1.04 + fontSize * 0.5

  const layer: TextLayer = {
    id: crypto.randomUUID(),
    type: 'text',
    name: line.text.length > 40 ? `${line.text.slice(0, 40)}…` : line.text,
    visible: true,
    locked: false,
    opacity: 1,
    x: origin.x,
    y: origin.y,
    width,
    height: 0,
    rotation: line.rect.angle + snap.rotation,
    text: line.text,
    fontFamily: family,
    fontSize,
    fontWeight: weight,
    italic: false,
    color: line.style.color,
    align: 'left',
    lineHeight: TEXT_LINE_HEIGHT,
    origin: 'ocr'
  }
  return { ...layer, height: measureTextHeight(layer) }
}

/**
 * Replaces the given detected lines with editable text: erases the original pixels (one patch per
 * group of nearby lines, or a new layer image) and adds matching text layers — all in one undo step.
 */
export async function convertLines(ids: string[]): Promise<void> {
  const snap = getSnapshot()
  const { docId, doc } = useDocumentStore.getState()
  const detect = useDetectStore.getState()
  const lines = detect.lines.filter((l) => ids.includes(l.id))
  if (!snap || !docId || !doc || lines.length === 0) return
  useDetectStore.setState({ status: 'converting', progress: 0 })

  try {
    const { image } = snap
    const regions = lineRegions(lines, image.width, image.height)
    const filled = new Uint8ClampedArray(image.data)
    let methodUsed: 'lama' | 'telea' = 'lama'

    for (const [n, region] of regions.entries()) {
      const result = await runJob(
        'inpaint',
        {
          width: region.width,
          height: region.height,
          pixels: cropPixels(image, region.x, region.y, region.width, region.height),
          textRects: region.members.map((m) => {
            const rect = (lines[m] as DetectedLine).rect
            return { ...rect, cx: rect.cx - region.x, cy: rect.cy - region.y }
          }),
          quality: 'auto'
        },
        // Erasing is the slow part: keep the bar moving within each region (0–70% overall).
        { onProgress: (p) => useDetectStore.setState({ progress: ((n + p) / regions.length) * 0.7 }) }
      )
      if (result.method === 'telea') methodUsed = 'telea'
      for (let row = 0; row < region.height; row++) {
        filled.set(
          result.pixels.subarray(row * region.width * 4, (row + 1) * region.width * 4),
          ((region.y + row) * image.width + region.x) * 4
        )
      }
      useDetectStore.setState({ progress: ((n + 1) / regions.length) * 0.7 })
    }

    const textLayers: TextLayer[] = []
    const fonts = await fontsFor(lines, snap)
    for (const line of lines) textLayers.push(textLayerFor(line, snap, fonts.get(line.id) ?? null))
    const write = await writeRaster(docId, snap, filled, regions)

    const target = snap.target
    useDocumentStore
      .getState()
      .commit(
        lines.length > 1 ? `Convert ${lines.length} text lines` : 'Convert text',
        (d: Draft<StudioDocument>) => {
          const insertAt = write(d)
          // Text that was part of the picture sits directly above it, below anything the user added on top.
          d.pages.find((p) => p.id === target.pageId)?.layers.splice(insertAt, 0, ...(textLayers as Layer[]))
        }
      )
    useDocumentStore.getState().select(textLayers.map((l) => l.id))

    const remaining = detect.lines.filter((l) => !ids.includes(l.id))
    if (remaining.length === 0) {
      matches.clear()
      resetDetect()
    } else {
      // Later conversions must start from the erased pixels.
      const fresh = useDocumentStore.getState().doc
      if (fresh) setSnapshot(await snapshot(fresh, target))
      useDetectStore.setState({ status: 'ready', lines: remaining, progress: 0 })
    }
    if (
      methodUsed === 'telea' &&
      !eraserTipShown &&
      useModelsStore.getState().statuses.find((s) => s.id === 'inpaint')?.state !== 'installed'
    ) {
      eraserTipShown = true
      notify.info(
        'Tip: install the High-quality eraser in Settings for cleaner backgrounds behind converted text.'
      )
    }
  } catch (error) {
    useDetectStore.setState({ status: 'ready', progress: 0 })
    notify.error(error, 'Could not convert the text')
  }
}
