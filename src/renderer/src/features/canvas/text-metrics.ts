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
