/** A PDF affine matrix [a b c d e f]: (x, y) ↦ (a·x + c·y + e, b·x + d·y + f). */
export type Matrix = [number, number, number, number, number, number]

/**
 * Maps a page's view space (points, origin bottom-left of the page as displayed, y up) to its PDF user
 * space, from pdf.js's viewport transform at scale 1 (user space → displayed, y down) and the
 * displayed height. Handles /Rotate and crop-box offsets.
 */
export function viewToPdf(viewport: readonly number[], viewHeight: number): Matrix {
  const [a, b, c, d, e, f] = viewport as Matrix
  // Inverse of the viewport transform (displayed, y down → user space).
  const det = a * d - b * c
  const inv: Matrix = [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
  // View space → displayed: (x, y) ↦ (x, viewHeight − y); then the inverse.
  return [inv[0], inv[1], -inv[2], -inv[3], inv[2] * viewHeight + inv[4], inv[3] * viewHeight + inv[5]]
}
