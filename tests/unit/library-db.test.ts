import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryDb } from '../../src/main/services/library-db'

let dir: string
let db: LibraryDb

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-lib-'))
  db = new LibraryDb(join(dir, 'library.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('LibraryDb', () => {
  it('migrates to the latest schema and is idempotent on reopen', () => {
    expect(db.schemaVersion).toBe(2)
    db.close()
    db = new LibraryDb(join(dir, 'library.db'))
    expect(db.schemaVersion).toBe(2)
  })

  it('orders recent projects newest first and upserts by path', () => {
    db.touchProject('C:/a.cmsp', 'A', null, new Date('2026-01-01'))
    db.touchProject('C:/b.cmsp', 'B', Uint8Array.of(1, 2), new Date('2026-01-02'))
    db.touchProject('C:/a.cmsp', 'A renamed', null, new Date('2026-01-03'))
    const recent = db.recentProjects()
    expect(recent.map((r) => r.name)).toEqual(['A renamed', 'B'])
    expect(Array.from(recent[1]?.thumbnail ?? [])).toEqual([1, 2])
  })

  it('keeps the previous thumbnail when none is given', () => {
    db.touchProject('C:/a.cmsp', 'A', Uint8Array.of(9), new Date('2026-01-01'))
    db.touchProject('C:/a.cmsp', 'A', null, new Date('2026-01-02'))
    expect(Array.from(db.recentProjects()[0]?.thumbnail ?? [])).toEqual([9])
  })

  it('forgets a project', () => {
    db.touchProject('C:/a.cmsp', 'A', null)
    db.forgetProject('C:/a.cmsp')
    expect(db.recentProjects()).toEqual([])
  })
})
