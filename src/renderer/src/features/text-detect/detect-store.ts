import { create } from 'zustand'
import type { OcrLine } from '@shared/ml/jobs'
import type { Point, RasterSnapshot, RasterTarget } from '../raster/raster-target'

export interface DetectedLine extends OcrLine {
  id: string
  /** Corners of the line's box on the page (for the overlay). */
  corners: Point[]
}

export type DetectStatus = 'idle' | 'preparing' | 'detecting' | 'ready' | 'converting' | 'error'

interface DetectState {
  status: DetectStatus
  target: RasterTarget | null
  progress: number
  lines: DetectedLine[]
  hoverId: string | null
  message: string | null
  provider: 'dml' | 'cpu' | null
}

export const useDetectStore = create<DetectState>()(() => ({
  status: 'idle',
  target: null,
  progress: 0,
  lines: [],
  hoverId: null,
  message: null,
  provider: null
}))

/** Pixels the current detection ran on (kept outside the store: ImageData is large). */
let currentSnapshot: RasterSnapshot | null = null

export function getSnapshot(): RasterSnapshot | null {
  return currentSnapshot
}

export function setSnapshot(snapshot: RasterSnapshot | null): void {
  currentSnapshot = snapshot
}

export function resetDetect(): void {
  currentSnapshot = null
  useDetectStore.setState({
    status: 'idle',
    target: null,
    progress: 0,
    lines: [],
    hoverId: null,
    message: null,
    provider: null
  })
}
