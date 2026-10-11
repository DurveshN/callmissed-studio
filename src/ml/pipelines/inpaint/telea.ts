import type { Rgba } from '../../image/raster'

const KNOWN = 0
const BAND = 1
const INSIDE = 2
const FAR = 1e6

/** Min-heap of pixel indices keyed by arrival time T. */
class Heap {
  private readonly keys: number[] = []
  private readonly items: number[] = []
  get size(): number {
    return this.items.length
  }
  push(item: number, key: number): void {
    this.items.push(item)
    this.keys.push(key)
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((this.keys[parent] as number) <= key) break
      this.swap(i, parent)
      i = parent
    }
  }
  pop(): number {
    const top = this.items[0] as number
    const lastItem = this.items.pop() as number
    const lastKey = this.keys.pop() as number
    if (this.items.length > 0) {
      this.items[0] = lastItem
      this.keys[0] = lastKey
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.items.length && (this.keys[l] as number) < (this.keys[m] as number)) m = l
        if (r < this.items.length && (this.keys[r] as number) < (this.keys[m] as number)) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }
  private swap(a: number, b: number): void {
    ;[this.items[a], this.items[b]] = [this.items[b] as number, this.items[a] as number]
    ;[this.keys[a], this.keys[b]] = [this.keys[b] as number, this.keys[a] as number]
  }
}

/**
 * Telea (2004) fast-marching inpainting: fills mask pixels (non-zero) from the boundary inward,
 * each from a weighted average of known pixels within `radius` (direction, distance, level-set terms).
 * Returns a new image; pixels outside the mask are unchanged.
 */
export function inpaintTelea(src: Rgba, mask: Uint8Array, radius = 5): Rgba {
  const { width, height } = src
  const out = { width, height, data: src.data.slice() }
  const n = width * height
  const flag = new Uint8Array(n)
  const T = new Float32Array(n)
  const heap = new Heap()

  for (let i = 0; i < n; i++) {
    if (mask[i]) {
      flag[i] = INSIDE
      T[i] = FAR
    }
  }
  // Narrow band: known pixels touching the masked region.
  for (let i = 0; i < n; i++) {
    if (flag[i] !== KNOWN) continue
    const x = i % width
    const y = (i - x) / width
    const touches =
      (x > 0 && flag[i - 1] === INSIDE) ||
      (x < width - 1 && flag[i + 1] === INSIDE) ||
      (y > 0 && flag[i - width] === INSIDE) ||
      (y < height - 1 && flag[i + width] === INSIDE)
    if (touches) {
      flag[i] = BAND
      heap.push(i, 0)
    }
  }

  const solve = (a: number, b: number): number => {
    const fa = flag[a] === INSIDE
    const fb = flag[b] === INSIDE
    if (fa && fb) return FAR
    if (fa) return (T[b] as number) + 1
    if (fb) return (T[a] as number) + 1
    const ta = T[a] as number
    const tb = T[b] as number
    const d = ta - tb
    if (d * d >= 2) return Math.min(ta, tb) + 1
    const r = Math.sqrt(2 - d * d)
    let s = (ta + tb - r) / 2
    if (s >= ta && s >= tb) return s
    s += r
    return s >= ta && s >= tb ? s : FAR
  }

  const fill = (i: number) => {
    const x = i % width
    const y = (i - x) / width
    // Gradient of T at the pixel (direction the front moves).
    const tAt = (xx: number, yy: number) => {
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) return null
      const j = yy * width + xx
      return flag[j] === INSIDE ? null : (T[j] as number)
    }
    const t0 = T[i] as number
    const tx1 = tAt(x + 1, y)
    const tx0 = tAt(x - 1, y)
    const ty1 = tAt(x, y + 1)
    const ty0 = tAt(x, y - 1)
    const gx =
      tx1 !== null && tx0 !== null ? (tx1 - tx0) / 2 : tx1 !== null ? tx1 - t0 : tx0 !== null ? t0 - tx0 : 0
    const gy =
      ty1 !== null && ty0 !== null ? (ty1 - ty0) / 2 : ty1 !== null ? ty1 - t0 : ty0 !== null ? t0 - ty0 : 0

    let wSum = 0
    const acc = [0, 0, 0]
    for (let dy = -radius; dy <= radius; dy++) {
      const yy = y + dy
      if (yy < 0 || yy >= height) continue
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx
        if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue
        const j = yy * width + xx
        if (flag[j] === INSIDE) continue
        const len2 = dx * dx + dy * dy
        if (len2 > radius * radius) continue
        const rx = x - xx
        const ry = y - yy
        let dir = (rx * gx + ry * gy) / Math.sqrt(len2)
        if (Math.abs(dir) <= 0.01) dir = 1e-6
        const dst = 1 / (len2 * Math.sqrt(len2))
        const lev = 1 / (1 + Math.abs((T[j] as number) - t0))
        const w = Math.abs(dir * dst * lev)
        wSum += w
        acc[0] = (acc[0] as number) + w * (out.data[j * 4] as number)
        acc[1] = (acc[1] as number) + w * (out.data[j * 4 + 1] as number)
        acc[2] = (acc[2] as number) + w * (out.data[j * 4 + 2] as number)
      }
    }
    if (wSum > 0) {
      out.data[i * 4] = Math.round((acc[0] as number) / wSum)
      out.data[i * 4 + 1] = Math.round((acc[1] as number) / wSum)
      out.data[i * 4 + 2] = Math.round((acc[2] as number) / wSum)
    }
    out.data[i * 4 + 3] = 255
  }

  while (heap.size > 0) {
    const i = heap.pop()
    if (flag[i] === KNOWN) continue
    flag[i] = KNOWN
    const x = i % width
    const y = (i - x) / width
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1
    ]
    for (const j of neighbors) {
      if (j < 0 || flag[j] !== INSIDE) continue
      const jx = j % width
      const jy = (j - jx) / width
      const h = (xx: number) => (xx >= 0 && xx < width ? jy * width + xx : -1)
      const v = (yy: number) => (yy >= 0 && yy < height ? yy * width + jx : -1)
      let t = FAR
      for (const a of [h(jx - 1), h(jx + 1)]) {
        for (const b of [v(jy - 1), v(jy + 1)]) {
          if (a < 0 && b < 0) continue
          const value =
            a < 0
              ? flag[b] === INSIDE
                ? FAR
                : (T[b] as number) + 1
              : b < 0
                ? flag[a] === INSIDE
                  ? FAR
                  : (T[a] as number) + 1
                : solve(a, b)
          if (value < t) t = value
        }
      }
      T[j] = t
      fill(j)
      flag[j] = BAND
      heap.push(j, t)
    }
  }
  return out
}
