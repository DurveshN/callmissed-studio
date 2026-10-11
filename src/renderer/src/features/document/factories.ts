import type { ImageLayer, ShapeLayer, TextLayer } from '@shared/document/model'

export const DEFAULT_FONT = 'Segoe UI'

/** Fonts available on every Windows 10/11 install (bundled OFL fonts arrive with OCR in M3). */
export const SYSTEM_FONTS = [
  'Segoe UI',
  'Arial',
  'Calibri',
  'Cambria',
  'Candara',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'Georgia',
  'Impact',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana'
]

const base = (name: string) => ({
  id: crypto.randomUUID(),
  name,
  visible: true,
  locked: false,
  opacity: 1,
  rotation: 0
})

export function newTextLayer(x: number, y: number, fontSize: number): TextLayer {
  return {
    ...base('Text'),
    type: 'text',
    x,
    y,
    width: fontSize * 8,
    height: fontSize * 1.2,
    text: 'Text',
    fontFamily: DEFAULT_FONT,
    fontSize,
    fontWeight: 400,
    italic: false,
    color: '#111111',
    align: 'left',
    lineHeight: 1.2,
    origin: 'user'
  }
}

export function newShapeLayer(
  shape: ShapeLayer['shape'],
  box: { x: number; y: number; width: number; height: number; rotation?: number },
  strokeWidth: number
): ShapeLayer {
  const names = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line' } as const
  return {
    ...base(names[shape]),
    type: 'shape',
    shape,
    ...box,
    rotation: box.rotation ?? 0,
    fill: shape === 'line' ? null : '#5b8def',
    stroke: shape === 'line' ? '#111111' : null,
    strokeWidth
  }
}

export function newImageLayer(
  assetId: string,
  name: string,
  box: { x: number; y: number; width: number; height: number }
): ImageLayer {
  return { ...base(name), type: 'image', assetId, origin: 'import', ...box }
}

/** Fits a w×h box inside maxW×maxH (never upscales), centered in the page. */
export function fitCentered(w: number, h: number, pageW: number, pageH: number, ratio = 0.6) {
  const scale = Math.min(1, (pageW * ratio) / w, (pageH * ratio) / h)
  const width = w * scale
  const height = h * scale
  return { x: (pageW - width) / 2, y: (pageH - height) / 2, width, height }
}
