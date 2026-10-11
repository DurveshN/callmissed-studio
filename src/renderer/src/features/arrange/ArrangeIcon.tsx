import { ChevronDown, ChevronsDown, ChevronsUp, ChevronUp } from 'lucide-react'
import type { ArrangeAction } from './arrange'

const ICONS = { front: ChevronsUp, forward: ChevronUp, backward: ChevronDown, back: ChevronsDown } as const

export function ArrangeIcon({ action, size = 16 }: { action: ArrangeAction; size?: number }) {
  const Icon = ICONS[action]
  return <Icon size={size} />
}
