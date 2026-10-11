import type { FontMatchResult } from '../fonts/font-match-protocol'
import { fontByFamily } from '../fonts/catalog'

/**
 * Below this recognition confidence a line is treated as handwriting or a mark. Printed text in phone
 * photos of documents still reads at ≥ 0.90; signatures and scribbles read far lower (0.5–0.86).
 */
const MIN_PRINTED_CONFIDENCE = 0.88
/** No font reproduces the ink at all… */
const NO_FONT_FITS = 0.05
/** …and the reading is not near-certain either (bold headers in uneven light can score low). */
const CERTAIN = 0.95

/**
 * Whether a detected line looks handwritten (or is otherwise not reproducible as typed text).
 * Such lines are skipped by "Convert all": a signature typed in a font is not a signature.
 */
export function looksHandwritten(confidence: number, match: FontMatchResult | null): boolean {
  if (confidence < MIN_PRINTED_CONFIDENCE) return true
  if (match && fontByFamily(match.family)?.category === 'handwriting') return true
  return (!match || match.score < NO_FONT_FITS) && confidence < CERTAIN
}
