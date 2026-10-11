import type Konva from 'konva'

/** The Konva group holding the active page's content (background, patches, layers), set by the canvas. */
let pageGroup: Konva.Group | null = null

export function registerPageGroup(group: Konva.Group | null): void {
  pageGroup = group
}

export function getPageGroup(): Konva.Group | null {
  return pageGroup
}
