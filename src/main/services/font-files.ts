import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import fontkit from '@cantoo/fontkit'
import { fontByFamily, type FontFile } from '@shared/fonts/catalog'

/** A font face file for drawing text in a PDF. */
export interface ResolvedFont {
  bytes: Uint8Array
  /** Face to use inside a collection (.ttc). */
  postscriptName?: string
  /** Variable font: its default instance is what an embedded copy shows; other weights need outlines. */
  variable: { defaultWeight: number } | null
  /** The weight to draw (variable fonts) or the face's own weight. */
  weight: number
  /** The family has no face for the requested style; it is synthesized like the browser does on screen. */
  syntheticBold: boolean
  syntheticItalic: boolean
}

const REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
  'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'
]

/** Registered Windows fonts: display name ("Arial Bold") → file path. */
export async function readRegistryFonts(fontsDir: string): Promise<Map<string, string>> {
  const fonts = new Map<string, string>()
  for (const key of REGISTRY_KEYS) {
    // The per-user key does not exist when no font was installed for the user only.
    const stdout = await promisify(execFile)('reg', ['query', key], { windowsHide: true }).then(
      (r) => r.stdout,
      () => ''
    )
    for (const line of stdout.split(/\r?\n/)) {
      const match = /^\s+(.+?)\s+REG_SZ\s+(.+?)\s*$/.exec(line)
      if (!match) continue
      const name = (match[1] as string).replace(/\s*\((TrueType|OpenType)\)$/i, '')
      const file = match[2] as string
      // Collections list every face they hold: "Cambria & Cambria Math".
      for (const part of name.split(' & '))
        fonts.set(part.toLowerCase(), isAbsolute(file) ? file : join(fontsDir, file))
    }
  }
  return fonts
}

const BOLD = 600

export class FontFiles {
  private registry: Promise<Map<string, string>> | null = null
  private readonly files = new Map<string, Promise<Uint8Array>>()

  constructor(
    /** Folders that may hold the renderer's public files (the bundled fonts). */
    private readonly bundledDirs: string[],
    private readonly fontsDir = join(process.env['WINDIR'] ?? 'C:\\Windows', 'Fonts'),
    private readonly listFonts: (fontsDir: string) => Promise<Map<string, string>> = readRegistryFonts
  ) {}

  /** The face to draw `family` at `weight` (italic if asked), or null when the family isn't available. */
  async resolve(family: string, weight: number, italic: boolean): Promise<ResolvedFont | null> {
    const known = fontByFamily(family)
    if (known?.source === 'bundled') return this.bundled(known.files, weight, italic)
    return this.system(family, weight, italic)
  }

  private read(path: string): Promise<Uint8Array> {
    let pending = this.files.get(path)
    if (!pending) {
      pending = readFile(path)
      pending.catch(() => this.files.delete(path))
      this.files.set(path, pending)
    }
    return pending
  }

  private async bundled(files: FontFile[], weight: number, italic: boolean): Promise<ResolvedFont | null> {
    // A variable file covering the weight, else the static file of the nearest weight.
    const covering = files.find(
      (f) => Array.isArray(f.weight) && f.weight[0] <= weight && weight <= f.weight[1]
    )
    const nearest = (f: FontFile) => Math.abs((typeof f.weight === 'number' ? f.weight : weight) - weight)
    const file = covering ?? [...files].sort((a, b) => nearest(a) - nearest(b))[0]
    if (!file) return null
    const dir = this.bundledDirs.find((d) => existsSync(join(d, file.path)))
    if (!dir) return null
    const bytes = await this.read(join(dir, file.path))
    const faceWeight = typeof file.weight === 'number' ? file.weight : weight
    let variable: ResolvedFont['variable'] = null
    if (Array.isArray(file.weight)) {
      const axes = (
        fontkit.create(bytes as Buffer) as unknown as { variationAxes: Record<string, { default: number }> }
      ).variationAxes
      variable = { defaultWeight: axes['wght']?.default ?? 400 }
    }
    return {
      bytes,
      variable,
      weight: faceWeight,
      syntheticBold: weight >= BOLD && faceWeight < BOLD,
      // No bundled family has italic faces; the browser slants them on screen.
      syntheticItalic: italic
    }
  }

  private async system(family: string, weight: number, italic: boolean): Promise<ResolvedFont | null> {
    this.registry ??= this.listFonts(this.fontsDir)
    const registry = await this.registry
    const bold = weight >= BOLD
    // Prefer the exact face; fall back to synthesizing the missing style.
    const tries: [boolean, boolean][] = [
      [bold, italic],
      [bold, false],
      [false, italic],
      [false, false]
    ]
    for (const [b, i] of tries) {
      const name = `${family}${b ? ' Bold' : ''}${i ? ' Italic' : ''}`
      const path = registry.get(name.toLowerCase())
      if (!path || !existsSync(path)) continue
      const bytes = await this.read(path)
      const face = path.toLowerCase().endsWith('.ttc') ? collectionFace(bytes, family, b, i) : undefined
      return {
        bytes,
        ...(face ? { postscriptName: face } : {}),
        variable: null,
        weight: b ? 700 : 400,
        syntheticBold: bold && !b,
        syntheticItalic: italic && !i
      }
    }
    return null
  }
}

/** PostScript name of the face of `family` with the given style inside a font collection. */
function collectionFace(
  bytes: Uint8Array,
  family: string,
  bold: boolean,
  italic: boolean
): string | undefined {
  const collection = fontkit.create(bytes as Buffer) as unknown as {
    fonts?: { familyName: string; subfamilyName: string; postscriptName: string }[]
  }
  const style = bold ? (italic ? 'bold italic' : 'bold') : italic ? 'italic' : 'regular'
  const faces = collection.fonts ?? []
  const face =
    faces.find((f) => f.familyName === family && f.subfamilyName.toLowerCase() === style) ??
    faces.find((f) => f.familyName === family)
  return face?.postscriptName
}
