let ctx: CanvasRenderingContext2D | null = null
const cache = new Map<string, boolean>()

/**
 * Whether `family` is a font installed on this machine: text in it measures differently from every
 * generic fallback. An unknown family silently renders in a fallback, and an alias (Windows maps
 * "Helvetica" to Arial) measures exactly like the default sans-serif, so neither counts.
 */
export function isFontInstalled(family: string): boolean {
  const known = cache.get(family)
  if (known !== undefined) return known
  ctx ??= document.createElement('canvas').getContext('2d')
  if (!ctx) return false
  const sample = 'mmmmmmmmmmlli1WQ@#'
  const width = (font: string) => {
    if (!ctx) return 0
    ctx.font = `72px ${font}`
    return ctx.measureText(sample).width
  }
  const quoted = `"${family.replace(/"/g, '')}"`
  const installed = ['monospace', 'serif', 'sans-serif'].every(
    (generic) => width(`${quoted}, ${generic}`) !== width(generic)
  )
  cache.set(family, installed)
  return installed
}
