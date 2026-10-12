import Konva from 'konva'
import type { TextLayer } from '@shared/document/model'

/** Konva font style string from weight + italic, e.g. "italic 700". */
export function fontStyle(layer: Pick<TextLayer, 'fontWeight' | 'italic'>): string {
  return `${layer.italic ? 'italic ' : ''}${layer.fontWeight}`
}

let probe: Konva.Text | null = null

/** Height the text occupies when wrapped to the layer width. */
export function measureTextHeight(layer: TextLayer): number {
  probe ??= new Konva.Text()
  probe.setAttrs({
    text: layer.text || ' ',
    width: layer.width,
    fontFamily: layer.fontFamily,
    fontSize: layer.fontSize,
    fontStyle: fontStyle(layer),
    lineHeight: layer.lineHeight,
    wrap: 'word'
  })
  return probe.height()
}

let metricsCtx: CanvasRenderingContext2D | null = null

/**
 * The text as Konva lays it out on screen: wrapped lines with their widths, the first baseline from
 * the box top (Konva's non-legacy layout: (fontAscent − fontDescent) / 2 + line height / 2), and the
 * distance between baselines.
 */
export function textLayout(layer: TextLayer): {
  lines: { text: string; width: number }[]
  baseline: number
  lineAdvance: number
} {
  probe ??= new Konva.Text()
  probe.setAttrs({
    text: layer.text,
    width: layer.width,
    fontFamily: layer.fontFamily,
    fontSize: layer.fontSize,
    fontStyle: fontStyle(layer),
    lineHeight: layer.lineHeight,
    align: layer.align,
    wrap: 'word'
  })
  const lines = (probe as unknown as { textArr: { text: string; width: number }[] }).textArr.map((l) => ({
    text: l.text,
    width: l.width
  }))
  metricsCtx ??= document.createElement('canvas').getContext('2d')
  const lineAdvance = layer.fontSize * layer.lineHeight
  let half = layer.fontSize * 0.4
  if (metricsCtx) {
    metricsCtx.font = `${fontStyle(layer)} ${layer.fontSize}px "${layer.fontFamily}"`
    const m = metricsCtx.measureText('M')
    half = (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2
  }
  return { lines, baseline: half + lineAdvance / 2, lineAdvance }
}
