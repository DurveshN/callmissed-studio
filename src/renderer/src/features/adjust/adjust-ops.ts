import type { Draft } from 'immer'
import type { Adjustments, StudioDocument } from '@shared/document/model'
import { useDocumentStore } from '../document/store'
import type { RasterTarget } from '../raster/raster-target'
import { isNeutral } from './adjust'

/** The adjustments of the page picture or image layer `target` (undefined when none). */
export function adjustmentsOf(
  doc: Draft<StudioDocument> | StudioDocument,
  target: RasterTarget
): Adjustments | undefined {
  const page = doc.pages.find((p) => p.id === target.pageId)
  if (target.kind === 'page') return page?.adjustments
  const layer = page?.layers.find((l) => l.id === target.layerId)
  return layer?.type === 'image' ? layer.adjustments : undefined
}

/** Sets the adjustments of a page picture or image layer; slider drags with `coalesceKey` are one undo step. */
export function setAdjustments(target: RasterTarget, adjustments: Adjustments, coalesceKey?: string): void {
  useDocumentStore.getState().commit(
    'Adjust',
    (d) => {
      const page = d.pages.find((p) => p.id === target.pageId)
      const owner =
        target.kind === 'page'
          ? page
          : page?.layers.find((l) => l.id === target.layerId && l.type === 'image')
      if (!owner || ('type' in owner && owner.type !== 'image')) return
      if (isNeutral(adjustments)) delete owner.adjustments
      else owner.adjustments = { ...adjustments }
    },
    coalesceKey
  )
}
