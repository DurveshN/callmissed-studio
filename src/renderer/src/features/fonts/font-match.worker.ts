/// <reference lib="webworker" />
import { ALL_FONTS, availableWeights, type FontFamily } from './catalog'
import { loadBundledFonts } from './load-fonts'
import {
  TEXT_LINE_HEIGHT as LINE_HEIGHT,
  type FontCandidate,
  type FontMatchRequest,
  type FontMatchResult,
  type FontWorkerMessage
} from './font-match-protocol'

/** Longest side of the ink box when scoring (keeps every comparison cheap). */
const SCORE_HEIGHT = 64

const scope = self as unknown as DedicatedWorkerGlobalScope
let ready: Promise<void> = Promise.resolve()
let usable: FontFamily[] = ALL_FONTS

function context(width: number, height: number): OffscreenCanvasRenderingContext2D {
  const ctx = new OffscreenCanvas(Math.max(1, width), Math.max(1, height)).getContext('2d', {
    willReadFrequently: true
  })
  if (!ctx) throw new Error('Canvas 2D unavailable in worker')
  return ctx
}

/** System fonts that are not installed render with a fallback; detect that by comparing widths. */
function installed(font: FontFamily): boolean {
  if (font.source === 'bundled') return true
  const ctx = context(8, 8)
  const sample = 'mmmmmmmmmmlli1WQ'
  const width = (family: string) => {
    ctx.font = `72px ${family}`
    return ctx.measureText(sample).width
  }
  return ['monospace', 'serif', 'sans-serif'].some(
    (fallback) => width(`"${font.family}", ${fallback}`) !== width(fallback)
  )
}

/** Ink coverage (0..1) of the target mask cropped to its ink box and scaled to `w`×`h`. */
function targetCoverage(req: FontMatchRequest, box: InkBox, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  const sx = box.width / w
  const sy = box.height / h
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ink = 0
      let total = 0
      for (
        let yy = Math.floor(y * sy);
        yy < Math.max(Math.floor(y * sy) + 1, Math.floor((y + 1) * sy));
        yy++
      ) {
        for (
          let xx = Math.floor(x * sx);
          xx < Math.max(Math.floor(x * sx) + 1, Math.floor((x + 1) * sx));
          xx++
        ) {
          total++
          ink += (req.mask[(box.top + yy) * req.width + box.left + xx] as number) / 255
        }
      }
      out[y * w + x] = total ? ink / total : 0
    }
  }
  return out
}

interface InkBox {
  left: number
  top: number
  width: number
  height: number
}

/** Bounding box of ink, optionally limited to columns [from, to). */
function inkBox(req: FontMatchRequest, from = 0, to = req.width): InkBox | null {
  let left = req.width
  let right = -1
  let top = req.height
  let bottom = -1
  for (let y = 0; y < req.height; y++) {
    for (let x = from; x < to; x++) {
      if (!req.mask[y * req.width + x]) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 }
}

/** A word of the line with its ink and target coverage at scoring resolution. */
interface Piece {
  text: string
  box: InkBox
  target: Float32Array
  w: number
  h: number
}

/**
 * Splits the line's ink into `count` words at its `count - 1` widest gaps (relative, so it works for
 * tight and for justified spacing). Null when there aren't enough gaps of plausible width.
 */
function wordSegments(req: FontMatchRequest, box: InkBox, count: number): [number, number][] | null {
  const columns = new Float32Array(box.width)
  for (let y = box.top; y < box.top + box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      columns[x] = (columns[x] as number) + (req.mask[y * req.width + box.left + x] as number) / 255
    }
  }
  const inked = [...columns].filter((v) => v > 0).sort((a, b) => a - b)
  const empty = Math.max(0.3, (inked[Math.floor(inked.length / 2)] ?? 0) * 0.08)
  const gaps: { start: number; length: number }[] = []
  for (let x = 0; x < box.width;) {
    if ((columns[x] as number) >= empty) {
      x++
      continue
    }
    const start = x
    while (x < box.width && (columns[x] as number) < empty) x++
    gaps.push({ start, length: x - start })
  }
  const minGap = Math.max(2, box.height * 0.12)
  const cuts = gaps
    .sort((a, b) => b.length - a.length)
    .slice(0, count - 1)
    .filter((g) => g.length >= minGap)
  if (cuts.length !== count - 1) return null
  cuts.sort((a, b) => a.start - b.start)
  const segments: [number, number][] = []
  let from = 0
  for (const cut of cuts) {
    segments.push([box.left + from, box.left + cut.start])
    from = cut.start + cut.length
  }
  segments.push([box.left + from, box.left + box.width])
  return segments
}

/**
 * Words matched separately when the ink splits into as many words as the text has: justified or
 * letter-spaced text has gaps no single-string rendering reproduces. Otherwise the whole line.
 */
function layoutsOf(req: FontMatchRequest, box: InkBox, scale: number): Piece[][] {
  const make = (text: string, b: InkBox): Piece => {
    const w = Math.max(4, Math.round(b.width * scale))
    const h = Math.max(4, Math.round(b.height * scale))
    return { text, box: b, target: targetCoverage(req, b, w, h), w, h }
  }
  const layouts: Piece[][] = [[make(req.text, box)]]
  const words = req.text.split(/\s+/).filter(Boolean)
  if (words.length > 1) {
    const segments = wordSegments(req, box, words.length)
    const boxes = segments?.map(([from, to]) => inkBox(req, from, to)) ?? []
    if (segments && boxes.every((b) => b !== null))
      layouts.push(words.map((word, i) => make(word, boxes[i] as InkBox)))
  }
  return layouts
}

/** Width-weighted overlap score and font size (crop px) of rendering `pieces` in a font. */
function scoreLayout(
  probe: OffscreenCanvasRenderingContext2D,
  css: (size: number) => string,
  pieces: Piece[]
): { score: number; size: number } | null {
  const totalWidth = pieces.reduce((sum, p) => sum + p.w, 0)
  let score = 0
  let size = 0
  for (const piece of pieces) {
    probe.font = css(100)
    const m = probe.measureText(piece.text)
    const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight
    const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
    if (inkW <= 0 || inkH <= 0) return null
    // Fit ink width; disagreement in ink height reveals a wrong typeface (e.g. condensed vs wide).
    const s = piece.w / inkW
    const heightError = Math.abs(inkH * s - piece.h) / piece.h
    const ctx = context(piece.w, piece.h)
    ctx.font = css(100 * s)
    ctx.fillStyle = '#000'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(piece.text, m.actualBoundingBoxLeft * s, m.actualBoundingBoxAscent * s)
    const rendered = ctx.getImageData(0, 0, piece.w, piece.h).data
    let inter = 0
    let union = 0
    for (let i = 0; i < piece.target.length; i++) {
      const a = piece.target[i] as number
      const b = (rendered[i * 4 + 3] as number) / 255
      inter += Math.min(a, b)
      union += Math.max(a, b)
    }
    const share = piece.w / totalWidth
    score += share * ((union ? inter / union : 0) - 0.6 * Math.min(1, heightError))
    size += share * ((100 * piece.box.width) / inkW)
  }
  return { score, size }
}

/** Weights worth trying for a family: regular and bold where available, else what exists. */
function candidateWeights(font: FontFamily): number[] {
  const weights = availableWeights(font)
  const picks = [400, 700].map((w) =>
    weights.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best))
  )
  return [...new Set(picks)]
}

/** How many ranked candidates are returned (for document-level consistency voting). */
const ALTERNATIVES = 8

function match(req: FontMatchRequest): FontMatchResult | null {
  const box = inkBox(req)
  if (!box || !req.text.trim()) return null
  const scale = Math.min(1, SCORE_HEIGHT / box.height)
  // The whole line, and (when the ink splits into the text's words) each word separately; the better
  // of the two counts, so neither justified spacing nor a misread space ruins a match.
  const layouts = layoutsOf(req, box, scale)
  const probe = context(8, 8)

  type Scored = { family: string; weight: number; fontSize: number; score: number }
  const perLayout: Scored[][] = layouts.map(() => [])
  const hasLowercase = /\p{Ll}/u.test(req.text)
  for (const font of usable) {
    if (font.capsOnly && hasLowercase) continue
    for (const weight of candidateWeights(font)) {
      const css = (size: number) => `${weight} ${size}px "${font.family}"`
      layouts.forEach((layout, k) => {
        const result = scoreLayout(probe, css, layout)
        if (result)
          perLayout[k]?.push({ family: font.family, weight, fontSize: result.size, score: result.score })
      })
    }
  }
  // One layout per line (the one whose best font fits best), so all fonts are compared on equal terms.
  const top = (list: Scored[]) => Math.max(-Infinity, ...list.map((c) => c.score))
  const scored = perLayout.reduce((best, list) => (top(list) > top(best) ? list : best), [] as Scored[])
  if (scored.length === 0) return null
  scored.sort((a, b) => b.score - a.score)

  // Where Konva (alphabetic baseline, non-legacy layout) will put the ink inside a text box at each size.
  const place = (c: (typeof scored)[number]): FontCandidate => {
    probe.font = `${c.weight} ${c.fontSize}px "${c.family}"`
    const metrics = probe.measureText(req.text)
    const sample = probe.measureText('M')
    const baseline =
      (sample.fontBoundingBoxAscent - sample.fontBoundingBoxDescent) / 2 + (LINE_HEIGHT * c.fontSize) / 2
    return {
      ...c,
      inkLeft: box.left + metrics.actualBoundingBoxLeft,
      inkTop: box.top - (baseline - metrics.actualBoundingBoxAscent)
    }
  }
  const alternatives = scored.slice(0, ALTERNATIVES).map(place)
  return { ...(alternatives[0] as FontCandidate), alternatives }
}

scope.onmessage = (event: MessageEvent<FontWorkerMessage>) => {
  const msg = event.data
  if (msg.type === 'init') {
    ready = loadBundledFonts(scope, msg.baseUrl).then(() => {
      usable = ALL_FONTS.filter(installed)
    })
    return
  }
  void ready
    .then(() => scope.postMessage({ id: msg.id, result: match(msg.request) }))
    .catch((error: unknown) =>
      scope.postMessage({ id: msg.id, error: error instanceof Error ? error.message : String(error) })
    )
}
