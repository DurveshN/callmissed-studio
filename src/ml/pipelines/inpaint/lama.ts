import { Tensor, type InferenceSession } from 'onnxruntime-node'
import { boxBlur, dilate } from '../../image/morphology'
import { createRgba, resize, type Gray, type Rgba } from '../../image/raster'

/** LaMa (Carve ONNX export): image RGB 0..1 and mask {0,1} at 512×512 in, RGB 0..255 out. */
const SIZE = 512
/** Context around the masked area, as a multiple of its size. */
const CONTEXT = 1.6

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function maskBounds(mask: Gray): Box | null {
  let x0 = mask.width
  let y0 = mask.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!mask.data[y * mask.width + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

/** Square crop around the mask with surrounding context, clamped to the image. */
function contextBox(bounds: Box, width: number, height: number): Box {
  const side = Math.min(
    Math.max(width, height),
    Math.max(Math.round(Math.max(bounds.width, bounds.height) * CONTEXT), 64)
  )
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  const w = Math.min(width, side)
  const h = Math.min(height, side)
  const x = Math.round(Math.min(Math.max(0, cx - w / 2), width - w))
  const y = Math.round(Math.min(Math.max(0, cy - h / 2), height - h))
  return { x, y, width: w, height: h }
}

function cropRgba(src: Rgba, box: Box): Rgba {
  const out = createRgba(box.width, box.height)
  for (let y = 0; y < box.height; y++) {
    const from = ((box.y + y) * src.width + box.x) * 4
    out.data.set(src.data.subarray(from, from + box.width * 4), y * box.width * 4)
  }
  return out
}

/** Fits `img` into SIZE×SIZE keeping aspect ratio; the rest is edge-replicated padding. */
function letterbox(img: Rgba): { padded: Rgba; scale: number; w: number; h: number } {
  const scale = SIZE / Math.max(img.width, img.height)
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const scaled = resize(img, w, h)
  const padded = createRgba(SIZE, SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const s = (Math.min(y, h - 1) * w + Math.min(x, w - 1)) * 4
      padded.data.set(scaled.data.subarray(s, s + 4), (y * SIZE + x) * 4)
    }
  }
  return { padded, scale, w, h }
}

/** Runs LaMa on 512×512 inputs: image RGB 0..1 [1,3,512,512] and mask {0,1} [1,1,512,512]; returns RGB 0..255. */
export type LamaInfer = (image: Float32Array, mask: Float32Array) => Promise<Float32Array>

export function lamaInfer(session: InferenceSession): LamaInfer {
  return async (image, mask) => {
    const outputs = await session.run({
      [session.inputNames[0] as string]: new Tensor('float32', image, [1, 3, SIZE, SIZE]),
      [session.inputNames[1] as string]: new Tensor('float32', mask, [1, 1, SIZE, SIZE])
    })
    const result = outputs[session.outputNames[0] as string]?.data as Float32Array | undefined
    if (!result) throw new Error('LaMa produced no output')
    return result
  }
}

/** Inpaints the masked pixels of `src` with LaMa using a context crop around the whole mask. */
export async function inpaintLama(infer: LamaInfer, src: Rgba, mask: Gray): Promise<Rgba> {
  const bounds = maskBounds(mask)
  if (!bounds) return { ...src, data: src.data.slice() }
  const box = contextBox(bounds, src.width, src.height)
  const crop = cropRgba(src, box)
  const { padded, w, h } = letterbox(crop)

  // Mask in letterbox space (nearest-neighbour sampling, then 1px dilation to cover resampling).
  const m: Gray = { width: SIZE, height: SIZE, data: new Uint8Array(SIZE * SIZE) }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(box.width - 1, Math.floor(((x + 0.5) * box.width) / w))
      const sy = Math.min(box.height - 1, Math.floor(((y + 0.5) * box.height) / h))
      if (mask.data[(box.y + sy) * mask.width + box.x + sx]) m.data[y * SIZE + x] = 255
    }
  }
  const m512 = dilate(m, 1)

  const plane = SIZE * SIZE
  const image = new Float32Array(3 * plane)
  const maskTensor = new Float32Array(plane)
  for (let i = 0; i < plane; i++) {
    image[i] = (padded.data[i * 4] as number) / 255
    image[plane + i] = (padded.data[i * 4 + 1] as number) / 255
    image[2 * plane + i] = (padded.data[i * 4 + 2] as number) / 255
    maskTensor[i] = m512.data[i] ? 1 : 0
  }
  const result = await infer(image, maskTensor)

  // Back to crop size (only the letterboxed area), then blend through a feathered mask.
  const generated = createRgba(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * SIZE + x
      const o = (y * w + x) * 4
      generated.data[o] = Math.round(Math.min(255, Math.max(0, result[i] as number)))
      generated.data[o + 1] = Math.round(Math.min(255, Math.max(0, result[plane + i] as number)))
      generated.data[o + 2] = Math.round(Math.min(255, Math.max(0, result[2 * plane + i] as number)))
      generated.data[o + 3] = 255
    }
  }
  const restored = resize(generated, box.width, box.height)
  const cropMask: Gray = {
    width: box.width,
    height: box.height,
    data: new Uint8Array(box.width * box.height)
  }
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++)
      cropMask.data[y * box.width + x] = mask.data[(box.y + y) * mask.width + box.x + x] as number
  }
  const alpha = boxBlur(dilate(cropMask, 2), 2)

  const out = { ...src, data: src.data.slice() }
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const a = (alpha.data[y * box.width + x] as number) / 255
      if (a === 0) continue
      const s = (y * box.width + x) * 4
      const d = ((box.y + y) * src.width + box.x + x) * 4
      for (let c = 0; c < 3; c++) {
        out.data[d + c] = Math.round(
          (src.data[d + c] as number) * (1 - a) + (restored.data[s + c] as number) * a
        )
      }
    }
  }
  return out
}
