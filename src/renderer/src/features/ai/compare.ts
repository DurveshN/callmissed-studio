import { create } from 'zustand'

interface CompareState {
  /** The AI result shown over the page, or null. */
  generationId: string | null
  /** Where the divider is, 0..1 of the page width: left of it the page, right of it the result. */
  split: number
}

export const useCompare = create<CompareState>()(() => ({ generationId: null, split: 0.5 }))

export function compare(generationId: string): void {
  useCompare.setState({ generationId, split: 0.5 })
}

export function closeCompare(): void {
  useCompare.setState({ generationId: null })
}
