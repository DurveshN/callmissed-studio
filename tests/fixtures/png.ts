import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

/** Decodes an 8-bit, non-interlaced RGB/RGBA PNG to RGBA (enough for the committed test fixtures). */
export function readPng(path: string): { width: number; height: number; data: Uint8Array } {
  const buf = readFileSync(path)
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const body = buf.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8 || body[12] !== 0) throw new Error('Only 8-bit non-interlaced PNGs are supported')
      colorType = body[9] as number
    } else if (type === 'IDAT') idat.push(body)
    offset += 12 + length
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (pixels[y * stride + x - channels] as number) : 0
      const b = y > 0 ? (pixels[(y - 1) * stride + x] as number) : 0
      const c = y > 0 && x >= channels ? (pixels[(y - 1) * stride + x - channels] as number) : 0
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      const predictor = [0, a, b, (a + b) >> 1, paeth][filter] ?? 0
      pixels[y * stride + x] = ((line[x] as number) + predictor) & 0xff
    }
  }
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = pixels[i * channels] as number
    data[i * 4 + 1] = pixels[i * channels + 1] as number
    data[i * 4 + 2] = pixels[i * channels + 2] as number
    data[i * 4 + 3] = channels === 4 ? (pixels[i * channels + 3] as number) : 255
  }
  return { width, height, data }
}
