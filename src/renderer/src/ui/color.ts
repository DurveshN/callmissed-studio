/** Hue 0..360, saturation and value 0..1. */
export interface Hsv {
  h: number
  s: number
  v: number
}

/** #rgb, #rrggbb or #rrggbbaa (alpha ignored) → lowercase #rrggbb; null when not a colour. */
export function normalizeHex(text: string): string | null {
  const raw = text.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${[...raw].map((c) => c + c).join('')}`
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(raw)) return `#${raw.slice(0, 6)}`
  return null
}

export function hexToHsv(hex: string): Hsv {
  const value = normalizeHex(hex) ?? '#000000'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number
  ]
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  let h = 0
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
  }
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : delta / max, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(5)}${channel(3)}${channel(1)}`
}
