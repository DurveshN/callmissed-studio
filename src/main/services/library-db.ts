import { DatabaseSync } from 'node:sqlite'

/** Ordered schema migrations; index + 1 is the resulting user_version. */
const MIGRATIONS = [
  `CREATE TABLE projects (
     path TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     thumbnail BLOB,
     last_opened_at TEXT NOT NULL
   );
   CREATE INDEX projects_last_opened ON projects(last_opened_at DESC);`,
  `CREATE TABLE api_calls (
     id INTEGER PRIMARY KEY,
     endpoint TEXT NOT NULL,
     model TEXT,
     http_status INTEGER,
     error_code TEXT,
     images INTEGER NOT NULL DEFAULT 0,
     credits REAL NOT NULL DEFAULT 0,
     latency_ms INTEGER NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE INDEX api_calls_created ON api_calls(created_at DESC);`
]

/** One request to the CallMissed API, as logged for the Usage view. */
export interface ApiCall {
  endpoint: string
  model: string | null
  /** Null when no response arrived (network failure, timeout, cancel). */
  httpStatus: number | null
  errorCode: string | null
  images: number
  credits: number
  latencyMs: number
  createdAt: string
}

export interface UsageSummary {
  generations: number
  failures: number
  images: number
  credits: number
  byModel: { model: string; images: number; credits: number }[]
  recent: ApiCall[]
}

export interface RecentRow {
  path: string
  name: string
  thumbnail: Uint8Array | null
  lastOpenedAt: string
}

const RECENT_LIMIT = 20

/** Local app library: recent projects and the CallMissed API calls this app made (usage). */
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

  logApiCall(call: ApiCall): void {
    this.db
      .prepare(
        `INSERT INTO api_calls (endpoint, model, http_status, error_code, images, credits, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        call.endpoint,
        call.model,
        call.httpStatus,
        call.errorCode,
        call.images,
        call.credits,
        call.latencyMs,
        call.createdAt
      )
  }

  /** Generation totals (all time, from this app) and the latest calls. */
  usage(recentLimit = 50): UsageSummary {
    const totals = this.db
      .prepare(
        `SELECT
           COUNT(*) FILTER (WHERE error_code IS NULL) AS generations,
           COUNT(*) FILTER (WHERE error_code IS NOT NULL) AS failures,
           COALESCE(SUM(images), 0) AS images,
           COALESCE(SUM(credits), 0) AS credits
         FROM api_calls WHERE endpoint = 'images/generations'`
      )
      .get() as { generations: number; failures: number; images: number; credits: number }
    const byModel = this.db
      .prepare(
        `SELECT model, SUM(images) AS images, SUM(credits) AS credits FROM api_calls
         WHERE endpoint = 'images/generations' AND error_code IS NULL
         GROUP BY model ORDER BY credits DESC`
      )
      .all() as { model: string; images: number; credits: number }[]
    const recent = this.db
      .prepare(
        `SELECT endpoint, model, http_status, error_code, images, credits, latency_ms, created_at
         FROM api_calls ORDER BY created_at DESC, id DESC LIMIT ?`
      )
      .all(recentLimit) as {
      endpoint: string
      model: string | null
      http_status: number | null
      error_code: string | null
      images: number
      credits: number
      latency_ms: number
      created_at: string
    }[]
    return {
      ...totals,
      byModel,
      recent: recent.map((r) => ({
        endpoint: r.endpoint,
        model: r.model,
        httpStatus: r.http_status,
        errorCode: r.error_code,
        images: r.images,
        credits: r.credits,
        latencyMs: r.latency_ms,
        createdAt: r.created_at
      }))
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
