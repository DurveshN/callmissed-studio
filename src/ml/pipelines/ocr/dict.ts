/**
 * Reads PostProcess.character_dict from a PaddleOCR inference.yml.
 * The list uses plain scalars or single-quoted scalars ('' escapes a quote); nothing else is needed.
 */
export function parseCharacterDict(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((l) => /^\s*character_dict:\s*$/.test(l))
  if (start < 0) throw new Error('character_dict not found in recognizer config')
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const match = /^(\s*)- (.*)$/.exec(lines[i] as string)
    if (!match) break
    out.push(unquote(match[2] as string))
  }
  if (out.length === 0) throw new Error('character_dict is empty')
  return out
}

function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'")
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) return JSON.parse(raw) as string
  return raw
}
