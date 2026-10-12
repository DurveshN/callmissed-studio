import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { degrees, PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { FontFiles } from '../../src/main/services/font-files'
import { writePdf } from '../../src/main/services/pdf-writer'
import type { PdfPlan } from '../../src/shared/pdf/plan'
import { viewToPdf } from '../../src/shared/pdf/view-matrix'

const IMAGE = '00000000-0000-4000-8000-0000000000a1'
const poster = readFileSync('tests/fixtures/ocr-poster.png')
const fonts = new FontFiles([join(process.cwd(), 'src', 'renderer', 'public')])

const text = (over: Partial<Extract<PdfPlan['pages'][number]['layers'][number], { type: 'text' }>>) => ({
  type: 'text' as const,
  x: 40,
  y: 40,
  width: 400,
  height: 40,
  rotation: 0,
  opacity: 1,
  family: 'Inter',
  weight: 400,
  italic: false,
  color: '#112233',
  fontSize: 24,
  align: 'left' as const,
  lineAdvance: 28,
  baseline: 22,
  lines: [{ text: 'Hello', width: 60 }],
  ...over
})

async function source(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 300])
  page.drawText('Original vector text', {
    x: 30,
    y: 250,
    size: 18,
    font: await doc.embedFont(StandardFonts.Helvetica)
  })
  page.setRotation(degrees(90))
  return doc.save()
}

async function read(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push({
      size: [page.view[2], page.view[3]],
      rotate: page.rotate,
      text: content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
    })
  }
  return pages
}

let out: Awaited<ReturnType<typeof read>> = []
let bytes: Uint8Array = new Uint8Array()

beforeAll(async () => {
  const original = await source()
  // As in the app: pdf.js's viewport of the source page gives the view → PDF mapping.
  const sourceViewport = (
    await (await getDocument({ data: original.slice() }).promise).getPage(1)
  ).getViewport({
    scale: 1
  }).transform
  const plan: PdfPlan = {
    title: 'Test',
    images: { [IMAGE]: poster },
    pages: [
      {
        width: 800,
        height: 600,
        unit: 0.75,
        base: { kind: 'new' },
        background: null,
        patches: [],
        layers: [
          text({ lines: [{ text: 'Regular Inter', width: 150 }] }),
          text({ y: 100, weight: 700, lines: [{ text: 'Bold Inter outlines', width: 230 }] }),
          text({
            y: 160,
            family: 'Arial',
            weight: 700,
            italic: true,
            lines: [{ text: 'Arial Bold Italic', width: 200 }]
          }),
          text({
            y: 220,
            family: 'Anton',
            weight: 700,
            rotation: 30,
            lines: [{ text: 'Synthetic bold', width: 200 }]
          }),
          {
            type: 'image',
            x: 450,
            y: 300,
            width: 300,
            height: 225,
            rotation: -10,
            opacity: 0.8,
            assetId: IMAGE
          },
          {
            type: 'shape',
            shape: 'rect',
            x: 40,
            y: 400,
            width: 120,
            height: 80,
            rotation: 0,
            opacity: 1,
            fill: '#5b8def',
            stroke: '#111111',
            strokeWidth: 3
          },
          {
            type: 'shape',
            shape: 'ellipse',
            x: 200,
            y: 400,
            width: 120,
            height: 80,
            rotation: 15,
            opacity: 0.5,
            fill: '#ff000080',
            stroke: null,
            strokeWidth: 0
          },
          {
            type: 'shape',
            shape: 'line',
            x: 40,
            y: 520,
            width: 300,
            height: 0,
            rotation: 5,
            opacity: 1,
            fill: null,
            stroke: '#000000',
            strokeWidth: 4
          }
        ],
        ocr: [{ text: 'Scanned words here', cx: 400, cy: 570, width: 300, height: 30, angle: 0 }]
      },
      {
        // The rotated source page as displayed: 300 × 400 pt at 2 page units per point.
        width: 600,
        height: 800,
        unit: 0.5,
        base: { kind: 'copy', index: 0, toPdf: viewToPdf(sourceViewport, 400) },
        background: null,
        patches: [{ assetId: IMAGE, x: 10, y: 10, width: 100, height: 75 }],
        layers: [text({ lines: [{ text: 'Added on the copy', width: 200 }] })],
        ocr: []
      }
    ]
  }
  bytes = await writePdf(plan, {
    source: original,
    readAsset: async () => {
      throw new Error('not used')
    },
    fonts
  })
  if (process.env['PDF_OUT']) (await import('node:fs')).writeFileSync(process.env['PDF_OUT'], bytes)
  out = await read(bytes)
}, 60_000)

describe('PDF writer', () => {
  it('writes every page with its size, keeping copied pages as they were', () => {
    expect(out).toHaveLength(2)
    expect(out[0]?.size).toEqual([600, 450])
    expect(out[1]?.size).toEqual([400, 300])
    expect(out[1]?.rotate).toBe(90)
  })

  it('writes text as searchable text: real fonts, outlined weights and invisible OCR text', () => {
    for (const s of [
      'Regular Inter',
      'Bold Inter outlines',
      'Arial Bold Italic',
      'Synthetic bold',
      'Scanned words here'
    ]) {
      expect(out[0]?.text).toContain(s)
    }
    expect(out[1]?.text).toContain('Original vector text')
    expect(out[1]?.text).toContain('Added on the copy')
  })

  it('embeds subset fonts rather than whole font files', () => {
    expect(bytes.byteLength).toBeLessThan(600_000)
  })
})
