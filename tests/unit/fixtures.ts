import { randomUUID } from 'node:crypto'
import type { StudioDocument } from '../../src/shared/document/model'

/** 1×1 transparent PNG. */
export const PNG_1PX = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  )
)

export function makeDocument(overrides: Partial<StudioDocument> = {}): StudioDocument {
  const assetId = randomUUID()
  return {
    id: randomUUID(),
    name: 'poster',
    source: { kind: 'image', fileName: 'poster.png', assetId },
    assets: { [assetId]: { mime: 'image/png' } },
    pages: [
      {
        id: randomUUID(),
        width: 1,
        height: 1,
        background: { kind: 'image', assetId },
        patches: [],
        layers: [
          {
            id: randomUUID(),
            type: 'text',
            name: 'Title',
            visible: true,
            locked: false,
            opacity: 1,
            x: 0,
            y: 0,
            width: 100,
            height: 20,
            rotation: 0,
            text: 'SALE',
            fontFamily: 'Segoe UI',
            fontSize: 16,
            fontWeight: 700,
            italic: false,
            color: '#111111',
            align: 'left',
            lineHeight: 1.2,
            origin: 'user'
          }
        ]
      }
    ],
    createdAt: new Date().toISOString(),
    ...overrides
  }
}
