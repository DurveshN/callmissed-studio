export type FontCategory = 'sans' | 'serif' | 'mono' | 'display' | 'handwriting'

export interface FontFile {
  /** Path under the renderer's public folder. */
  path: string
  /** A single weight, or the [min, max] range of a variable font. */
  weight: number | [number, number]
}

export interface FontFamily {
  family: string
  category: FontCategory
  /** Bundled (OFL, always available) or a font that ships with Windows 10/11. */
  source: 'bundled' | 'system'
  /** Has no lowercase letters (lowercase input renders as capitals), so it can't match mixed-case text. */
  capsOnly?: boolean
  files: FontFile[]
}

const bundled = (family: string, category: FontCategory, files: FontFile[]): FontFamily => ({
  family,
  category,
  source: 'bundled',
  files
})

/** Weight ranges are read from each file's fvar/OS2 table (see fonts/README.md). */
export const BUNDLED_FONTS: FontFamily[] = [
  bundled('Inter', 'sans', [{ path: 'fonts/inter/Inter[opsz,wght].ttf', weight: [100, 900] }]),
  bundled('Roboto', 'sans', [{ path: 'fonts/roboto/Roboto[wdth,wght].ttf', weight: [100, 900] }]),
  bundled('Open Sans', 'sans', [{ path: 'fonts/opensans/OpenSans[wdth,wght].ttf', weight: [300, 800] }]),
  bundled('Lato', 'sans', [
    { path: 'fonts/lato/Lato-Regular.ttf', weight: 400 },
    { path: 'fonts/lato/Lato-Bold.ttf', weight: 700 }
  ]),
  bundled('Montserrat', 'sans', [{ path: 'fonts/montserrat/Montserrat[wght].ttf', weight: [100, 900] }]),
  bundled('Poppins', 'sans', [
    { path: 'fonts/poppins/Poppins-Regular.ttf', weight: 400 },
    { path: 'fonts/poppins/Poppins-SemiBold.ttf', weight: 600 },
    { path: 'fonts/poppins/Poppins-Bold.ttf', weight: 700 }
  ]),
  bundled('Raleway', 'sans', [{ path: 'fonts/raleway/Raleway[wght].ttf', weight: [100, 900] }]),
  bundled('Oswald', 'display', [{ path: 'fonts/oswald/Oswald[wght].ttf', weight: [200, 700] }]),
  {
    ...bundled('Bebas Neue', 'display', [{ path: 'fonts/bebasneue/BebasNeue-Regular.ttf', weight: 400 }]),
    capsOnly: true
  },
  bundled('Anton', 'display', [{ path: 'fonts/anton/Anton-Regular.ttf', weight: 400 }]),
  bundled('Merriweather', 'serif', [
    { path: 'fonts/merriweather/Merriweather[opsz,wdth,wght].ttf', weight: [300, 900] }
  ]),
  bundled('Playfair Display', 'serif', [
    { path: 'fonts/playfairdisplay/PlayfairDisplay[wght].ttf', weight: [400, 900] }
  ]),
  bundled('Lora', 'serif', [{ path: 'fonts/lora/Lora[wght].ttf', weight: [400, 700] }]),
  bundled('Source Serif 4', 'serif', [
    { path: 'fonts/sourceserif4/SourceSerif4[opsz,wght].ttf', weight: [200, 900] }
  ]),
  bundled('Roboto Mono', 'mono', [{ path: 'fonts/robotomono/RobotoMono[wght].ttf', weight: [100, 700] }]),
  bundled('Dancing Script', 'handwriting', [
    { path: 'fonts/dancingscript/DancingScript[wght].ttf', weight: [400, 700] }
  ]),
  bundled('Caveat', 'handwriting', [{ path: 'fonts/caveat/Caveat[wght].ttf', weight: [400, 700] }])
]

const system = (family: string, category: FontCategory): FontFamily => ({
  family,
  category,
  source: 'system',
  files: []
})

/** Fonts installed with every Windows 10/11 (not redistributed; used by name only). */
export const SYSTEM_FONTS: FontFamily[] = [
  system('Segoe UI', 'sans'),
  system('Arial', 'sans'),
  system('Calibri', 'sans'),
  system('Verdana', 'sans'),
  system('Tahoma', 'sans'),
  system('Trebuchet MS', 'sans'),
  system('Times New Roman', 'serif'),
  system('Georgia', 'serif'),
  system('Cambria', 'serif'),
  system('Consolas', 'mono'),
  system('Courier New', 'mono'),
  system('Impact', 'display')
]

export const ALL_FONTS: FontFamily[] = [...BUNDLED_FONTS, ...SYSTEM_FONTS]

export const DEFAULT_FONT = 'Inter'

export function fontByFamily(family: string): FontFamily | undefined {
  return ALL_FONTS.find((f) => f.family === family)
}

/** Weights a family can actually render (variable ranges are sampled at 100 steps). */
export function availableWeights(font: FontFamily): number[] {
  if (font.source === 'system') return [400, 700]
  const weights = new Set<number>()
  for (const file of font.files) {
    if (typeof file.weight === 'number') weights.add(file.weight)
    else for (let w = file.weight[0]; w <= file.weight[1]; w += 100) weights.add(w)
  }
  return [...weights].sort((a, b) => a - b)
}
