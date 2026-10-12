import { rectCorners, type RotatedRect } from '@shared/geometry/rotated-rect'
import { ALL_FONTS } from '../fonts/catalog'

/** A family the editor has, with the weight and style a PDF font name asks for. */
export interface PdfFontStyle {
  family: string
  weight: number
  italic: boolean
}

const WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/, 100],
  [/extra-?light|ultra-?light/, 200],
  [/semi-?bold|demi-?bold|demi/, 600],
  [/extra-?bold|ultra-?bold/, 800],
  [/black|heavy/, 900],
  [/light/, 300],
  [/medium/, 500],
  [/bold/, 700]
]

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Reads a PDF font name ("ABCDEF+Calibri-Bold", "TimesNewRomanPS-BoldItalicMT", "Arial,Italic") as a
 * catalog family, weight and italic. Unknown families fall back by kind (serif, monospace, sans).
 */
export function parsePdfFont(name: string, hints: { serif?: boolean; mono?: boolean } = {}): PdfFontStyle {
  const clean = name
    .replace(/^[A-Z]{6}\+/, '') // subset prefix
    .replace(/-\d+$/, '') // numeric suffix some writers append
  const cut = clean.search(/[-,]/)
  const familyPart = (cut >= 0 ? clean.slice(0, cut) : clean).replace(/(PSMT|PS|MT)$/, '')
  const style = (cut >= 0 ? clean.slice(cut + 1) : '').toLowerCase()
  const weight = WEIGHTS.find(([re]) => re.test(style))?.[1] ?? 400
  const italic = /italic|oblique/.test(style)
  const known = ALL_FONTS.find((f) => squash(f.family) === squash(familyPart))
  const family = known?.family ?? (hints.mono ? 'Courier New' : hints.serif ? 'Times New Roman' : 'Arial')
  return { family, weight, italic }
}

/** A run of text as pdf.js reports it, already in page units (y down). */
export interface TextRun {
  text: string
  /** Baseline start. */
  x: number
  y: number
  /** Direction of the text in degrees (clockwise, y down). */
  angle: number
  /** Font size (em) and advance width along the baseline. */
  size: number
  width: number
  /** Runs of different fonts never share a line. */
  font: string
  /** Ascent and descent as fractions of the size (descent negative). */
  ascent: number
  descent: number
}

/** Consecutive runs on one baseline in one font, joined into a line (spaces added where the gap shows one). */
export function groupRuns(runs: TextRun[]): TextRun[] {
  const lines: TextRun[] = []
  for (const run of runs) {
    if (!run.text.trim()) continue
    const last = lines.at(-1)
    if (last && continues(last, run)) {
      const rad = (last.angle * Math.PI) / 180
      const gap = (run.x - last.x) * Math.cos(rad) + (run.y - last.y) * Math.sin(rad) - last.width
      const spaced = gap > 0.12 * last.size && !last.text.endsWith(' ') && !run.text.startsWith(' ')
      last.text += (spaced ? ' ' : '') + run.text
      last.width += gap + run.width
    } else {
      lines.push({ ...run })
    }
  }
  return lines.map((l) => ({ ...l, text: l.text.trim() }))
}

function continues(line: TextRun, run: TextRun): boolean {
  if (run.font !== line.font || Math.abs(run.size - line.size) > 0.1 * line.size) return false
  if (Math.abs(run.angle - line.angle) > 1) return false
  const rad = (line.angle * Math.PI) / 180
  const dx = run.x - line.x
  const dy = run.y - line.y
  // Offset across the baseline, and gap along it after the line's end.
  const across = -dx * Math.sin(rad) + dy * Math.cos(rad)
  const gap = dx * Math.cos(rad) + dy * Math.sin(rad) - line.width
  return Math.abs(across) < 0.25 * line.size && gap > -0.3 * line.size && gap < 1.5 * line.size
}

/** The rotated box (page units) around a line, from its baseline, ascent and descent. */
export function runBox(run: TextRun): {
  cx: number
  cy: number
  width: number
  height: number
  angle: number
} {
  const rad = (run.angle * Math.PI) / 180
  const top = -run.ascent * run.size
  const bottom = -run.descent * run.size
  const along = run.width / 2
  const across = (top + bottom) / 2
  return {
    cx: run.x + along * Math.cos(rad) - across * Math.sin(rad),
    cy: run.y + along * Math.sin(rad) + across * Math.cos(rad),
    width: run.width,
    height: bottom - top,
    angle: run.angle
  }
}

/** Whether a point lies inside a rotated rectangle. */
function inside(rect: RotatedRect, x: number, y: number): boolean {
  const rad = (rect.angle * Math.PI) / 180
  const dx = x - rect.cx
  const dy = y - rect.cy
  const u = dx * Math.cos(rad) + dy * Math.sin(rad)
  const v = -dx * Math.sin(rad) + dy * Math.cos(rad)
  return Math.abs(u) <= rect.width / 2 && Math.abs(v) <= rect.height / 2
}

/**
 * Text colour inside `rect`: the pixels farthest from the box's typical (background) colour.
 * Returns the background too.
 */
export function inkColor(
  image: { width: number; height: number; data: Uint8ClampedArray | Uint8Array },
  rect: RotatedRect
): { color: string; background: string } {
  const corners = rectCorners(rect)
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))))
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))))
  const x1 = Math.min(image.width, Math.ceil(Math.max(...corners.map((c) => c.x))))
  const y1 = Math.min(image.height, Math.ceil(Math.max(...corners.map((c) => c.y))))
  const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / 20_000)))
  const pixels: [number, number, number][] = []
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      if (!inside(rect, x + 0.5, y + 0.5)) continue
      const i = (y * image.width + x) * 4
      pixels.push([image.data[i] as number, image.data[i + 1] as number, image.data[i + 2] as number])
    }
  }
  const hex = ([r, g, b]: [number, number, number]) =>
    `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
  if (pixels.length === 0) return { color: '#000000', background: '#ffffff' }
  const median = (list: [number, number, number][]): [number, number, number] =>
    [0, 1, 2].map((c) => {
      const values = list.map((p) => p[c] as number).sort((a, b) => a - b)
      return values[Math.floor(values.length / 2)] as number
    }) as [number, number, number]
  const background = median(pixels)
  const far = pixels
    .map((p) => ({ p, d: Math.hypot(p[0] - background[0], p[1] - background[1], p[2] - background[2]) }))
    .filter((e) => e.d > 60)
    .sort((a, b) => b.d - a.d)
  const ink = far.slice(0, Math.max(1, Math.ceil(far.length / 4))).map((e) => e.p)
  return { color: far.length ? hex(median(ink)) : '#000000', background: hex(background) }
}
