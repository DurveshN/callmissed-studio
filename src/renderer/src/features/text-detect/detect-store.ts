import { create } from 'zustand'
import type { OcrLine } from '@shared/ml/jobs'
import type { Point, RasterSnapshot, RasterTarget } from '../raster/raster-target'
import type { NativeText } from './pdf-text'

export interface DetectedLine extends OcrLine {
  id: string
  /** Corners of the line's box on the page (for the overlay). */
  corners: Point[]
  /** Looks handwritten or unreliable: skipped by "Convert all", still convertible by clicking it. */
  handwriting: boolean
  /** Text a PDF page states itself (exact words, font and baseline); absent for recognized text. */
  native?: NativeText
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
