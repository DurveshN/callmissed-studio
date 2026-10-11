import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { packProject, unpackProject, type ProjectContents } from '../../src/main/services/project-file'
import { SCHEMA_VERSION } from '../../src/shared/project/format'
import { makeDocument, PNG_1PX } from './fixtures'

function contents(): ProjectContents {
  const document = makeDocument()
  return {
    manifest: {
      format: 'cmsp',
      schemaVersion: SCHEMA_VERSION,
      appVersion: '0.1.0',
      createdAt: '2026-10-11T00:00:00.000Z',
      updatedAt: '2026-10-11T00:00:00.000Z'
    },
    document,
    history: { undo: [{ label: 'Add text', patches: [], inverse: [] }], redo: [] },
    thumbnail: PNG_1PX,
    assets: { [`${document.source.assetId}.png`]: PNG_1PX }
  }
}

describe('project file', () => {
  it('round-trips without loss', () => {
    const original = contents()
    const restored = unpackProject(packProject(original))
    expect(restored).toEqual(original)
  })

  it('rejects files that are not zips', () => {
    expect(() => unpackProject(strToU8('hello'))).toThrow(/Not a valid/)
  })

  it('rejects projects from a newer schema', () => {
    const c = contents()
    const bytes = packProject({ ...c, manifest: { ...c.manifest, schemaVersion: SCHEMA_VERSION + 1 } })
    expect(() => unpackProject(bytes)).toThrow(/newer version/)
  })

  it('rejects an invalid document', () => {
    const c = contents()
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify(c.manifest)),
      'document.json': strToU8(JSON.stringify({ ...c.document, pages: [] }))
    })
    expect(() => unpackProject(bytes)).toThrow(/document is invalid/)
  })

  it('ignores unexpected and path-traversal entries', () => {
    const c = contents()
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify(c.manifest)),
      'document.json': strToU8(JSON.stringify(c.document)),
      '../evil.exe': strToU8('x'),
      'assets/../../evil.png': strToU8('x')
    })
    const restored = unpackProject(bytes)
    expect(restored.assets).toEqual({})
    expect(restored.history).toEqual({ undo: [], redo: [] })
  })
})
