import { create } from 'zustand'

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 32
const FIT_PADDING = 48

interface ViewportState {
  scale: number
  x: number
  y: number
  /** Size of the canvas element in CSS pixels. */
  width: number
  height: number
  setSize(width: number, height: number): void
  fit(pageWidth: number, pageHeight: number): void
  /** Zooms keeping the given screen point fixed (defaults to the viewport center). */
  zoomTo(scale: number, anchor?: { x: number; y: number }): void
  zoomBy(factor: number, anchor?: { x: number; y: number }): void
  panBy(dx: number, dy: number): void
}

const clamp = (v: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v))

export const useViewportStore = create<ViewportState>()((set, get) => ({
  scale: 1,
  x: 0,
  y: 0,
  width: 0,
  height: 0,

  setSize: (width, height) => set({ width, height }),

  fit: (pageWidth, pageHeight) => {
    const { width, height } = get()
    if (width === 0 || height === 0) return
    const scale = clamp(
      Math.min((width - FIT_PADDING * 2) / pageWidth, (height - FIT_PADDING * 2) / pageHeight)
    )
    set({ scale, x: (width - pageWidth * scale) / 2, y: (height - pageHeight * scale) / 2 })
  },

  zoomTo: (target, anchor) => {
    const { scale, x, y, width, height } = get()
    const next = clamp(target)
    const point = anchor ?? { x: width / 2, y: height / 2 }
    const worldX = (point.x - x) / scale
    const worldY = (point.y - y) / scale
    set({ scale: next, x: point.x - worldX * next, y: point.y - worldY * next })
  },

  zoomBy: (factor, anchor) => get().zoomTo(get().scale * factor, anchor),

  panBy: (dx, dy) => set((s) => ({ x: s.x + dx, y: s.y + dy }))
}))
