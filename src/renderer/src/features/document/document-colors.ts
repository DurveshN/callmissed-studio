import { useShallow } from 'zustand/react/shallow'
import { useDocumentStore } from './store'

/** Colours used by text and shapes anywhere in the document, most used first. */
export function useDocumentColors(): string[] {
  return useDocumentStore(
    useShallow((s) => {
      const counts = new Map<string, number>()
      for (const page of s.doc?.pages ?? [])
        for (const layer of page.layers) {
          const colors =
            layer.type === 'text' ? [layer.color] : layer.type === 'shape' ? [layer.fill, layer.stroke] : []
          for (const c of colors)
            if (c) counts.set(c.slice(0, 7).toLowerCase(), (counts.get(c.slice(0, 7).toLowerCase()) ?? 0) + 1)
        }
      return [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c)
    })
  )
}
