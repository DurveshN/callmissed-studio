import { rectCorners, type RotatedRect } from '../../image/geometry'
import { resize, rotate90ccw, warpQuad, type Rgba } from '../../image/raster'

export const REC = {
  height: 48,
  minWidth: 16,
  maxWidth: 3200,
  batchSize: 8
}

/** Crops a detected line upright; tall crops are treated as vertical text and rotated. */
export function cropLine(src: Rgba, rect: RotatedRect): Rgba {
  const crop = warpQuad(
    src,
    rectCorners(rect),
    Math.max(1, Math.round(rect.width)),
    Math.max(1, Math.round(rect.height))
  )
  return crop.height / crop.width >= 1.5 ? rotate90ccw(crop) : crop
}

/** Width a crop occupies once scaled to the recognizer height. */
export function recWidth(crop: Rgba): number {
  return Math.min(REC.maxWidth, Math.max(REC.minWidth, Math.ceil((REC.height * crop.width) / crop.height)))
}

/** Builds an NCHW BGR batch normalized to [-1, 1], right-padded with zeros to the widest crop. */
export function buildRecBatch(crops: Rgba[]): {
  tensor: Float32Array
  dims: [number, number, number, number]
} {
  const width = Math.max(...crops.map(recWidth))
  const plane = REC.height * width
  const tensor = new Float32Array(crops.length * 3 * plane)
  crops.forEach((crop, n) => {
    const w = recWidth(crop)
    const img = resize(crop, w, REC.height)
    const base = n * 3 * plane
    for (let y = 0; y < REC.height; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4
        const d = y * width + x
        tensor[base + d] = ((img.data[s + 2] as number) / 255 - 0.5) / 0.5
        tensor[base + plane + d] = ((img.data[s + 1] as number) / 255 - 0.5) / 0.5
        tensor[base + 2 * plane + d] = ((img.data[s] as number) / 255 - 0.5) / 0.5
      }
    }
  })
  return { tensor, dims: [crops.length, 3, REC.height, width] }
}

export interface Recognized {
  text: string
  confidence: number
  /** Decoded characters (before normalization) with the output time step that produced each. */
  chars: { ch: string; step: number }[]
  /** Number of output time steps (spans the batch's padded input width). */
  steps: number
}

/**
 * Greedy CTC decode of [batch, time, classes] probabilities.
 * Class 0 is the blank, 1..dict.length map to the dictionary, and the last class is a space.
 */
export function ctcDecode(probs: Float32Array, dims: readonly number[], dict: string[]): Recognized[] {
  const [batch, steps, classes] = dims as [number, number, number]
  const out: Recognized[] = []
  for (let n = 0; n < batch; n++) {
    const chars: { ch: string; step: number }[] = []
    let confidence = 0
    let previous = -1
    for (let t = 0; t < steps; t++) {
      const base = (n * steps + t) * classes
      let best = 0
      let bestP = -Infinity
      for (let c = 0; c < classes; c++) {
        const p = probs[base + c] as number
        if (p > bestP) {
          bestP = p
          best = c
        }
      }
      if (best !== 0 && best !== previous) {
        chars.push({ ch: best <= dict.length ? (dict[best - 1] as string) : ' ', step: t })
        confidence += bestP
      }
      previous = best
    }
    out.push({
      text: normalizeText(chars.map((c) => c.ch).join('')),
      confidence: chars.length ? confidence / chars.length : 0,
      chars,
      steps
    })
  }
  return out
}

/** NFKC turns presentation forms (ligatures such as 'ﬂ', full-width letters) into plain text. */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/ {2,}/g, ' ').trim()
}

/** A space needs an empty gap in the ink at least this wide (fraction of the ink height). */
const MIN_SPACE_GAP = 0.12
/** A column with less than this share of a typical letter column's ink counts as empty. */
const EMPTY_COLUMN = 0.15

/**
 * Removes recognized spaces that have no visible gap in the ink around them (e.g. the recognizer
 * splitting a ligature: "fl ags"). `inkPerColumn` is ink coverage per column of the line crop.
 */
export function dropFalseSpaces(
  read: Recognized,
  layout: { batchWidth: number; scaledWidth: number; cropWidth: number; inkHeight: number },
  inkPerColumn: Float32Array
): string {
  const toCrop = (step: number) =>
    (((step + 0.5) / read.steps) * layout.batchWidth * layout.cropWidth) / layout.scaledWidth
  const need = Math.max(1, layout.inkHeight * MIN_SPACE_GAP)
  // "Empty" is relative to how much ink a letter column holds, so paper texture and camera noise in
  // photos (a little ink in every gap) don't hide real spaces.
  const inked = [...inkPerColumn].filter((v) => v >= 0.5).sort((x, y) => x - y)
  const typical = inked[Math.floor(inked.length / 2)] ?? 0
  const empty = Math.max(0.5, typical * EMPTY_COLUMN)
  const kept = read.chars.filter(({ ch, step }) => {
    if (ch !== ' ') return true
    const x = toCrop(step)
    const from = Math.max(0, Math.floor(x - layout.inkHeight * 0.6))
    const to = Math.min(inkPerColumn.length - 1, Math.ceil(x + layout.inkHeight * 0.6))
    let run = 0
    for (let c = from; c <= to; c++) {
      run = (inkPerColumn[c] as number) < empty ? run + 1 : 0
      if (run >= need) return true
    }
    return false
  })
  return normalizeText(kept.map((c) => c.ch).join(''))
}
