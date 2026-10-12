import Konva from 'konva'
import { useEffect, type RefObject } from 'react'
import type { Adjustments } from '@shared/document/model'
import { adjustPixels, isNeutral } from './adjust'

/** Konva filter reading the node's `adjustments` attribute. */
function adjustFilter(this: Konva.Node, imageData: ImageData): void {
  const a = this.getAttr('adjustments') as Adjustments | undefined
  if (a) adjustPixels(imageData.data, a)
}

/**
 * Applies `adjustments` to a Konva node with a filter. Filters need the node cached; it is cached at
 * `pixelRatio` (pixels per node unit, i.e. the source's native resolution) so zooming in and exporting
 * keep full detail. `deps` must change whenever the node's content does (e.g. its image loads).
 */
export function useAdjustments(
  ref: RefObject<Konva.Node | null>,
  adjustments: Adjustments | undefined,
  pixelRatio: number,
  deps: readonly unknown[]
): void {
  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (isNeutral(adjustments)) {
      node.clearCache()
      node.filters([])
    } else {
      node.setAttr('adjustments', adjustments)
      node.cache({ pixelRatio: Math.max(1, pixelRatio) })
      node.filters([adjustFilter])
    }
    node.getLayer()?.batchDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass content changes in `deps`
  }, [adjustments?.brightness, adjustments?.contrast, adjustments?.saturation, pixelRatio, ...deps])
}
