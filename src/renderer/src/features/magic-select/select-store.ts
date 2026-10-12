import { create } from 'zustand'
import type { MaskCrop } from '@shared/ml/jobs'
import type { RasterTarget } from '../raster/raster-target'

export interface PromptPoint {
  x: number
  y: number
  label: 0 | 1
}

/** Where the target's raster pixels sit on the page (Konva group transform). */
export interface Placement {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
}

export type SelectStatus = 'idle' | 'preparing' | 'selecting' | 'ready' | 'applying' | 'error'

interface SelectState {
  status: SelectStatus
  target: RasterTarget | null
  placement: Placement | null
  /** Prompt in raster pixels of the target. */
  points: PromptPoint[]
  box: { x0: number; y0: number; x1: number; y1: number } | null
  mask: MaskCrop | null
  progress: number | null
  message: string | null
}

export const initialSelect: SelectState = {
  status: 'idle',
  target: null,
  placement: null,
  points: [],
  box: null,
  mask: null,
  progress: null,
  message: null
}

export const useSelectStore = create<SelectState>()(() => initialSelect)
