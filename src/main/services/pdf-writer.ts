import fontkit from '@cantoo/fontkit'
import {
  beginText,
  concatTransformationMatrix,
  degrees,
  endText,
  LineCapStyle,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  type Color,
  type PDFFont,
  type PDFImage,
  type PDFPage
} from '@cantoo/pdf-lib'
import type { PdfLayer, PdfOcrLine, PdfPage, PdfPlan, PdfText } from '@shared/pdf/plan'
import type { FontFiles, ResolvedFont } from './font-files'

export interface WriterDeps {
  /** The document's original PDF (needed for pages based on it). */
  source: Uint8Array | null
  /** Bytes of a workspace asset (PNG or JPEG). */
  readAsset(assetId: string): Promise<Uint8Array>
  fonts: FontFiles
}

/** Used when a layer's family is not available on this machine, and for invisible OCR text. */
const FALLBACK_FAMILY = 'Lato'
/** Chromium slants text by about this much when a family has no italic face. */
const SYNTHETIC_ITALIC_DEG = 14
/** Stroke width (× font size) approximating Chromium's synthetic bold. */
const SYNTHETIC_BOLD = 1 / 30

/** #rrggbb or #rrggbbaa → colour and its own opacity. */
function parseColor(hex: string): { color: Color; alpha: number } {
  const v = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255
  return { color: rgb(v(1), v(3), v(5)), alpha: hex.length === 9 ? v(7) : 1 }
}

type Fontkit = {
  unitsPerEm: number
  getVariation(settings: Record<string, number>): Fontkit
  layout(text: string): {
    glyphs: { path: { commands: { command: string; args: number[] }[] } }[]
    positions: { xAdvance: number; xOffset: number; yOffset: number }[]
  }
}

/** One page of the plan, drawn into `page` (whose view space is `toPdf` of its user space). */
class PageWriter {
  private readonly k: number
  private readonly height: number

  constructor(
    private readonly writer: Writer,
    private readonly page: PDFPage,
    private readonly plan: PdfPage
  ) {
    this.k = plan.unit
    this.height = plan.height * plan.unit
  }

  async draw(): Promise<void> {
    const { page, plan } = this
    const [a, b, c, d, e, f] = plan.base.kind === 'copy' ? plan.base.toPdf : [1, 0, 0, 1, 0, 0]
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, e, f))
    if (plan.background) {
      page.drawImage(await this.writer.image(plan.background), {
        x: 0,
        y: 0,
        width: plan.width * this.k,
        height: this.height
      })
    }
    for (const patch of plan.patches) {
      page.drawImage(await this.writer.image(patch.assetId), {
        x: patch.x * this.k,
        y: this.height - (patch.y + patch.height) * this.k,
        width: patch.width * this.k,
        height: patch.height * this.k
      })
    }
    for (const layer of plan.layers) await this.layer(layer)
    for (const line of plan.ocr) await this.ocrLine(line)
    page.pushOperators(popGraphicsState())
  }

  /**
   * Runs `draw` in the layer's own frame: origin at its top-left corner, turned with it, in page
   * units with y up (so its box spans x 0..width, y −height..0).
   */
  private async inFrame(x: number, y: number, rotation: number, draw: () => Promise<void> | void) {
    const r = (rotation * Math.PI) / 180
    const k = this.k
    this.page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(
        k * Math.cos(r),
        -k * Math.sin(r),
        k * Math.sin(r),
        k * Math.cos(r),
        x * k,
        this.height - y * k
      )
    )
    await draw()
    this.page.pushOperators(popGraphicsState())
  }

  private async layer(layer: PdfLayer): Promise<void> {
    const { page } = this
    await this.inFrame(layer.x, layer.y, layer.rotation, async () => {
      const { width: w, height: h, opacity } = layer
      if (layer.type === 'image') {
        page.drawImage(await this.writer.image(layer.assetId), { x: 0, y: -h, width: w, height: h, opacity })
        return
      }
      if (layer.type === 'text') {
        await this.text(layer)
        return
      }
      const fill = layer.fill ? parseColor(layer.fill) : null
      const stroke = layer.stroke ? parseColor(layer.stroke) : null
      const paint = {
        ...(fill ? { color: fill.color, opacity: opacity * fill.alpha } : {}),
        ...(stroke && layer.strokeWidth > 0
          ? {
              borderColor: stroke.color,
              borderOpacity: opacity * stroke.alpha,
              borderWidth: layer.strokeWidth
            }
          : {})
      }
      if (layer.shape === 'line') {
        const color = stroke ?? parseColor('#000000')
        page.drawLine({
          start: { x: 0, y: 0 },
          end: { x: w, y: 0 },
          thickness: layer.strokeWidth,
          color: color.color,
          opacity: opacity * color.alpha,
          lineCap: LineCapStyle.Round
        })
      } else if (fill || stroke) {
        if (layer.shape === 'rect') page.drawRectangle({ x: 0, y: -h, width: w, height: h, ...paint })
        else page.drawEllipse({ x: w / 2, y: -h / 2, xScale: w / 2, yScale: h / 2, ...paint })
      }
    })
  }

  /** A text layer as laid out on screen: real text in an embedded font, or exact outlines plus invisible text. */
  private async text(layer: PdfText): Promise<void> {
    const face = await this.writer.face(layer.family, layer.weight, layer.italic)
    const font = await this.writer.font(face)
    const { color, alpha } = parseColor(layer.color)
    const opacity = layer.opacity * alpha
    // A variable font embeds as its default instance; any other weight is drawn from its outlines.
    const outlines = face.variable !== null && face.variable.defaultWeight !== layer.weight
    const skew = face.syntheticItalic ? SYNTHETIC_ITALIC_DEG : 0
    layer.lines.forEach((line, i) => {
      if (!line.text) return
      const y = -(layer.baseline + i * layer.lineAdvance)
      const x =
        layer.align === 'left'
          ? 0
          : layer.align === 'center'
            ? (layer.width - line.width) / 2
            : layer.width - line.width
      const options = { x, y, size: layer.fontSize, font, xSkew: degrees(skew) }
      if (outlines) {
        const shapes = this.writer.outlines(face, layer.weight, line.text, layer.fontSize, skew)
        if (shapes) this.page.drawSvgPath(shapes, { x, y, color, opacity, borderWidth: 0 })
        // Invisible text on top keeps the line searchable and copyable.
        this.page.drawText(line.text, { ...options, renderMode: TextRenderingMode.Invisible })
        return
      }
      this.page.drawText(line.text, {
        ...options,
        color,
        opacity,
        ...(face.syntheticBold
          ? {
              renderMode: TextRenderingMode.FillAndOutline,
              strokeColor: color,
              strokeWidth: layer.fontSize * SYNTHETIC_BOLD
            }
          : {})
      })
    })
  }

  /** Recognized text of a scanned page: invisible, stretched over its line so selection matches the scan. */
  private async ocrLine(line: PdfOcrLine): Promise<void> {
    const font = await this.writer.font(await this.writer.face(FALLBACK_FAMILY, 400, false))
    const r = (line.angle * Math.PI) / 180
    // Top-left corner of the rotated line box.
    const x = line.cx - (line.width / 2) * Math.cos(r) + (line.height / 2) * Math.sin(r)
    const y = line.cy - (line.width / 2) * Math.sin(r) - (line.height / 2) * Math.cos(r)
    const size = line.height * 0.8
    const natural = font.widthOfTextAtSize(line.text, size)
    if (natural <= 0) return
    const key = this.page.node.newFontDictionary(font.name, font.ref)
    await this.inFrame(x, y, line.angle, () => {
      this.page.pushOperators(
        beginText(),
        setFontAndSize(key, size),
        setTextRenderingMode(TextRenderingMode.Invisible),
        setCharacterSqueeze((line.width / natural) * 100),
        setTextMatrix(1, 0, 0, 1, 0, -line.height * 0.8),
        showText(font.encodeText(line.text)),
        endText()
      )
    })
  }
}

/** Shared resources of one export: embedded images and fonts are reused across pages. */
class Writer {
  private readonly images = new Map<string, Promise<PDFImage>>()
  private readonly fonts = new Map<Uint8Array, Map<string, Promise<PDFFont>>>()
  private readonly instances = new Map<string, Fontkit>()

  constructor(
    readonly doc: PDFDocument,
    private readonly plan: PdfPlan,
    private readonly deps: WriterDeps
  ) {}

  image(assetId: string): Promise<PDFImage> {
    let pending = this.images.get(assetId)
    if (!pending) {
      pending = (async () => {
        const bytes = this.plan.images[assetId] ?? (await this.deps.readAsset(assetId))
        if (bytes[0] === 0x89 && bytes[1] === 0x50) return this.doc.embedPng(bytes)
        if (bytes[0] === 0xff && bytes[1] === 0xd8) return this.doc.embedJpg(bytes)
        throw new Error('Only PNG and JPEG pictures can be written to a PDF')
      })()
      this.images.set(assetId, pending)
    }
    return pending
  }

  async face(family: string, weight: number, italic: boolean): Promise<ResolvedFont> {
    const face =
      (await this.deps.fonts.resolve(family, weight, italic)) ??
      (await this.deps.fonts.resolve(FALLBACK_FAMILY, weight, italic))
    if (!face) throw new Error(`No font available for "${family}"`)
    return face
  }

  font(face: ResolvedFont): Promise<PDFFont> {
    let byName = this.fonts.get(face.bytes)
    if (!byName) this.fonts.set(face.bytes, (byName = new Map()))
    const name = face.postscriptName ?? ''
    let pending = byName.get(name)
    if (!pending) {
      pending = this.doc.embedFont(face.bytes, {
        subset: true,
        ...(face.postscriptName ? { postscriptName: face.postscriptName } : {})
      })
      byName.set(name, pending)
    }
    return pending
  }

  /** SVG path (y down, origin at the baseline start) of `text` in a variable font at `weight`. */
  outlines(face: ResolvedFont, weight: number, text: string, size: number, skewDeg: number): string | null {
    const key = `${face.bytes.byteLength}:${face.bytes[100]}:${weight}`
    let font = this.instances.get(key)
    if (!font) {
      font = (fontkit.create(face.bytes as Buffer) as unknown as Fontkit).getVariation({ wght: weight })
      this.instances.set(key, font)
    }
    const s = size / font.unitsPerEm
    const slant = Math.tan((skewDeg * Math.PI) / 180)
    const run = font.layout(text)
    const parts: string[] = []
    let pen = 0
    run.glyphs.forEach((glyph, i) => {
      const position = run.positions[i] ?? { xAdvance: 0, xOffset: 0, yOffset: 0 }
      const ox = pen + position.xOffset
      const oy = position.yOffset
      // Font units (y up) → path units (y down), slanted for synthetic italics.
      const pt = (gx: number, gy: number) => {
        const up = (gy + oy) * s
        return `${((gx + ox) * s + up * slant).toFixed(3)} ${(-up).toFixed(3)}`
      }
      for (const { command, args } of glyph.path.commands) {
        const points = []
        for (let j = 0; j + 1 < args.length; j += 2) points.push(pt(args[j] as number, args[j + 1] as number))
        if (command === 'moveTo') parts.push(`M${points[0]}`)
        else if (command === 'lineTo') parts.push(`L${points[0]}`)
        else if (command === 'quadraticCurveTo') parts.push(`Q${points.join(' ')}`)
        else if (command === 'bezierCurveTo') parts.push(`C${points.join(' ')}`)
        else if (command === 'closePath') parts.push('Z')
      }
      pen += position.xAdvance
    })
    return parts.length ? parts.join('') : null
  }
}

/** Writes the plan as a PDF: source pages copied (vectors and text kept) with edits drawn over them. */
export async function writePdf(plan: PdfPlan, deps: WriterDeps): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle(plan.title)
  doc.setProducer('CallMissed Studio')
  doc.setCreator('CallMissed Studio')
  const source = plan.pages.some((p) => p.base.kind === 'copy')
    ? deps.source
      ? await PDFDocument.load(deps.source)
      : null
    : null
  if (plan.pages.some((p) => p.base.kind === 'copy') && !source)
    throw new Error('The original PDF is missing')
  const writer = new Writer(doc, plan, deps)
  for (const pagePlan of plan.pages) {
    let page: PDFPage
    if (pagePlan.base.kind === 'copy' && source) {
      const [copied] = await doc.copyPages(source, [pagePlan.base.index])
      if (!copied) throw new Error(`Page ${pagePlan.base.index + 1} of the original PDF is missing`)
      page = doc.addPage(copied)
    } else {
      page = doc.addPage([pagePlan.width * pagePlan.unit, pagePlan.height * pagePlan.unit])
    }
    await new PageWriter(writer, page, pagePlan).draw()
  }
  return doc.save()
}
