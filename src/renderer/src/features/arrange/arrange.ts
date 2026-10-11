import type { Layer } from '@shared/document/model'
import { shiftLayers } from '../document/layer-ops'

export type ArrangeAction = 'front' | 'forward' | 'backward' | 'back'

const DELTA: Record<ArrangeAction, number> = { front: Infinity, forward: 1, backward: -1, back: -Infinity }

export const ARRANGE_ACTIONS: { action: ArrangeAction; label: string; shortcut: string }[] = [
  { action: 'front', label: 'Bring to front', shortcut: 'Ctrl+Shift+]' },
  { action: 'forward', label: 'Bring forward', shortcut: 'Ctrl+]' },
  { action: 'backward', label: 'Send backward', shortcut: 'Ctrl+[' },
  { action: 'back', label: 'Send to back', shortcut: 'Ctrl+Shift+[' }
]

/**
 * Whether the action would change anything: upward moves are no-ops when the selection already
 * occupies the top slots, downward moves when it occupies the bottom slots (just above the background).
 */
export function canArrange(layers: Layer[], ids: string[], action: ArrangeAction): boolean {
  const indices = layers.flatMap((l, i) => (ids.includes(l.id) ? [i] : []))
  if (indices.length === 0) return false
  const upward = action === 'front' || action === 'forward'
  const offset = upward ? layers.length - indices.length : 0
  return !indices.every((index, j) => index === offset + j)
}

export function arrange(ids: string[], action: ArrangeAction): void {
  shiftLayers(ids, DELTA[action])
}
