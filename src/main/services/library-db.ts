import { DatabaseSync } from 'node:sqlite'

/** Ordered schema migrations; index + 1 is the resulting user_version. */
const MIGRATIONS = [
  `CREATE TABLE projects (
     path TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     thumbnail BLOB,
     last_opened_at TEXT NOT NULL
   );
   CREATE INDEX projects_last_opened ON projects(last_opened_at DESC);`
]

export interface RecentRow {
  path: string
  name: string
  thumbnail: Uint8Array | null
  lastOpenedAt: string
}

const RECENT_LIMIT = 20

/** Local app library (recent projects; generations and API usage are added in later milestones). */
export class LibraryDb {
  private readonly db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  private migrate(): void {
    const { user_version: current } = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN')
      try {
        this.db.exec(MIGRATIONS[v] as string)
        this.db.exec(`PRAGMA user_version = ${v + 1}`)
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
  }

  get schemaVersion(): number {
    return (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  }

  touchProject(path: string, name: string, thumbnail: Uint8Array | null, at = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO projects (path, name, thumbnail, last_opened_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           name = excluded.name,
           thumbnail = COALESCE(excluded.thumbnail, projects.thumbnail),
           last_opened_at = excluded.last_opened_at`
      )
      .run(path, name, thumbnail, at.toISOString())
  }

  recentProjects(): RecentRow[] {
    const rows = this.db
      .prepare(
        'SELECT path, name, thumbnail, last_opened_at FROM projects ORDER BY last_opened_at DESC LIMIT ?'
      )
      .all(RECENT_LIMIT) as {
      path: string
      name: string
      thumbnail: Uint8Array | null
      last_opened_at: string
    }[]
    return rows.map((r) => ({
      path: r.path,
      name: r.name,
      thumbnail: r.thumbnail,
      lastOpenedAt: r.last_opened_at
    }))
  }

  forgetProject(path: string): void {
    this.db.prepare('DELETE FROM projects WHERE path = ?').run(path)
  }

  close(): void {
    this.db.close()
  }
}
