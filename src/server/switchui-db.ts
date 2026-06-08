import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { getHermesRoot } from './claude-paths'

const DEFAULT_DB_NAME = 'switchui.db'

const dbCache = new Map<string, Database.Database>()

export function getSwitchUiDbPath(): string {
  const override = process.env.SWITCHUI_DB_PATH?.trim()
  if (override) return override
  return join(getHermesRoot(), DEFAULT_DB_NAME)
}

export function getSwitchUiDb(): Database.Database {
  const dbPath = getSwitchUiDbPath()
  let db = dbCache.get(dbPath)
  if (db) return db

  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 })
  db = new Database(dbPath, { readonly: false })
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (!existsSync(file)) continue
    try {
      chmodSync(file, 0o600)
    } catch {
      // best-effort: permissions should not block app startup
    }
  }
  dbCache.set(dbPath, db)
  return db
}

export function __resetSwitchUiDbForTests(): void {
  for (const db of dbCache.values()) {
    try {
      db.close()
    } catch {
      // ignore test cleanup close errors
    }
  }
  dbCache.clear()
}
