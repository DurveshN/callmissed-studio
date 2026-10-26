/**
 * Parses a page range such as "1-3, 5, 8-" (1-based, as people write them) into 0-based page
 * indexes in the order written. Null when it is empty or names a page outside 1..count.
 */
export function parsePageRange(text: string, count: number): number[] | null {
  const parts = text.split(',').map((p) => p.trim())
  if (parts.every((p) => p === '')) return null
  const pages: number[] = []
  for (const part of parts) {
    if (part === '') continue
    const match = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(part)
    if (!match || (!match[1] && !match[3])) return null
    const from = match[1] ? Number(match[1]) : 1
    const to = match[2] ? (match[3] ? Number(match[3]) : count) : from
    if (from < 1 || to < 1 || from > count || to > count) return null
    const step = from <= to ? 1 : -1
    for (let p = from; p !== to + step; p += step) pages.push(p - 1)
  }
  return pages
}
