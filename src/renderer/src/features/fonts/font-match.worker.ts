/// <reference lib="webworker" />
import { ALL_FONTS, availableWeights, type FontFamily } from './catalog'
import { loadBundledFonts } from './load-fonts'
import {
  TEXT_LINE_HEIGHT as LINE_HEIGHT,
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
          if (req.mask[(box.top + yy) * req.width + box.left + xx]) ink++
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

function inkBox(req: FontMatchRequest): InkBox | null {
  let left = req.width
  let right = -1
  let top = req.height
  let bottom = -1
  for (let y = 0; y < req.height; y++) {
    for (let x = 0; x < req.width; x++) {
      if (!req.mask[y * req.width + x]) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 }
}

/** Weights worth trying for a family: regular and bold where available, else what exists. */
function candidateWeights(font: FontFamily): number[] {
  const weights = availableWeights(font)
  const picks = [400, 700].map((w) =>
    weights.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best))
  )
  return [...new Set(picks)]
}

function match(req: FontMatchRequest): FontMatchResult | null {
  const box = inkBox(req)
  if (!box || !req.text.trim()) return null
  const scale = Math.min(1, SCORE_HEIGHT / box.height)
  const w = Math.max(4, Math.round(box.width * scale))
  const h = Math.max(4, Math.round(box.height * scale))
  const target = targetCoverage(req, box, w, h)
  const ctx = context(w, h)
  const probe = context(8, 8)

  let best: (FontMatchResult & { score: number }) | null = null
  for (const font of usable) {
    for (const weight of candidateWeights(font)) {
      const css = (size: number) => `${weight} ${size}px "${font.family}"`
      probe.font = css(100)
      const m = probe.measureText(req.text)
      const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight
      const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
      if (inkW <= 0 || inkH <= 0) continue

      // Fit ink width; disagreement in ink height reveals a wrong typeface (e.g. condensed vs wide).
      const s = w / inkW
      const heightError = Math.abs(inkH * s - h) / h
      if (heightError > 0.6) continue
      ctx.clearRect(0, 0, w, h)
      ctx.font = css(100 * s)
      ctx.fillStyle = '#000'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(req.text, m.actualBoundingBoxLeft * s, m.actualBoundingBoxAscent * s)
      const rendered = ctx.getImageData(0, 0, w, h).data
      let inter = 0
      let union = 0
      for (let i = 0; i < target.length; i++) {
        const a = target[i] as number
        const b = (rendered[i * 4 + 3] as number) / 255
        inter += Math.min(a, b)
        union += Math.max(a, b)
      }
      const score = (union ? inter / union : 0) - 0.6 * heightError
      if (!best || score > best.score) {
        best = {
          family: font.family,
          weight,
          fontSize: (100 * box.width) / inkW,
          score,
          inkLeft: 0,
          inkTop: 0
        }
      }
    }
  }
  if (!best) return null

  // Where Konva (alphabetic baseline, non-legacy layout) will put the ink inside a text box at this size.
  probe.font = `${best.weight} ${best.fontSize}px "${best.family}"`
  const metrics = probe.measureText(req.text)
  const sample = probe.measureText('M')
  const baseline =
    (sample.fontBoundingBoxAscent - sample.fontBoundingBoxDescent) / 2 + (LINE_HEIGHT * best.fontSize) / 2
  return {
    family: best.family,
    weight: best.weight,
    fontSize: best.fontSize,
    score: best.score,
    // Offset from the text box's top-left to the ink box's top-left, and the ink box in the crop.
    inkLeft: box.left - -metrics.actualBoundingBoxLeft,
    inkTop: box.top - (baseline - metrics.actualBoundingBoxAscent)
  }
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
