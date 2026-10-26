import { PDF_RENDER_SCALE, type Page, type StudioDocument, type TextLayer } from '@shared/document/model'
import { availableWeights, fontByFamily } from '../fonts/catalog'

/**
 * How font sizes are shown: in points on PDF pages (as in other PDF editors), in pixels on pictures.
 * `perUnit` converts a layer's font size (page units) to the shown number.
 */
export function fontSizeUnit(doc: StudioDocument, page: Page): { perUnit: number; suffix: 'pt' | 'px' } {
  return page.background.kind === 'pdf' || doc.source.kind === 'pdf'
    ? { perUnit: 1 / PDF_RENDER_SCALE, suffix: 'pt' }
    : { perUnit: 1, suffix: 'px' }
}

export const isBold = (layer: TextLayer) => layer.fontWeight >= 600

/**
 * The weight that turns bold on or off: the family's closest weight to 700 (or 400), else 700 (or
 * 400) itself, which is drawn as synthetic bold on screen and in exported PDFs.
 */
export function toggledWeight(layer: TextLayer): number {
  const font = fontByFamily(layer.fontFamily)
  const bold = !isBold(layer)
  const target = bold ? 700 : 400
  const candidates = (font ? availableWeights(font) : []).filter((w) => w >= 600 === bold)
  return (
    candidates.reduce<number | null>(
      (best, w) => (best === null || Math.abs(w - target) < Math.abs(best - target) ? w : best),
      null
    ) ?? target
  )
}
