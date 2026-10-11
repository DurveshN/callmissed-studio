import { BUNDLED_FONTS } from './catalog'

/** FontFaceSet of a window or worker scope. */
interface FontScope {
  fonts: { add(face: FontFace): unknown }
}

let loaded: Promise<void> | null = null

/** Registers every bundled font with `scope` (the page or a worker) and waits until all are usable. */
export function loadBundledFonts(scope: FontScope, baseUrl: string): Promise<void> {
  const faces = BUNDLED_FONTS.flatMap((font) =>
    font.files.map((file) => {
      const weight =
        typeof file.weight === 'number' ? String(file.weight) : `${file.weight[0]} ${file.weight[1]}`
      const face = new FontFace(font.family, `url("${new URL(file.path, baseUrl).toString()}")`, { weight })
      scope.fonts.add(face)
      return face.load()
    })
  )
  return Promise.all(faces).then(() => undefined)
}

/** Loads bundled fonts into the page once (Konva text and the inspector need them before rendering). */
export function ensurePageFonts(): Promise<void> {
  loaded ??= loadBundledFonts(document as unknown as FontScope, document.baseURI)
  return loaded
}
