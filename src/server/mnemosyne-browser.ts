import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getHermesRoot, getProfileHermesHome } from './claude-paths'

export type MnemosyneStatsCounts = {
  working: number
  episodic: number
  triples: number
  fts: number
  total: number
}

export type MnemosyneStats = {
  checkedAt: number
  db: { exists: boolean }
  counts: MnemosyneStatsCounts
  missingReason?: string
}

function getDefaultBankId(): string {
  const fromEnv = process.env.MNEMOSYNE_BANK_ID?.trim()
  if (fromEnv) return fromEnv
  return 'default'
}

function getCandidateDbPaths(bankId = getDefaultBankId()): Array<string> {
  const explicitDbPath = process.env.MNEMOSYNE_DB_PATH?.trim()
  if (explicitDbPath) return [path.resolve(explicitDbPath)]

  const explicitDataDir = process.env.MNEMOSYNE_DATA_DIR?.trim()
  if (explicitDataDir) {
    const dataDir = path.resolve(explicitDataDir)
    return [
      path.join(dataDir, bankId === 'default' ? 'mnemosyne.db' : path.join('banks', bankId, 'mnemosyne.db')),
    ]
  }

  const hermesRoot = getHermesRoot()
  const profileMnemosyneDataDir = path.join(
    getProfileHermesHome('hermes-switch'),
    'matrix-memory',
    'data',
  )
  const rootMnemosyneDataDir = path.join(hermesRoot, 'mnemosyne', 'data')

  if (bankId === 'default') {
    return [
      path.join(profileMnemosyneDataDir, 'mnemosyne.db'),
      path.join(rootMnemosyneDataDir, 'mnemosyne.db'),
      path.join(rootMnemosyneDataDir, 'default.db'),
    ]
  }

  return [
    path.join(profileMnemosyneDataDir, 'banks', bankId, 'mnemosyne.db'),
    path.join(rootMnemosyneDataDir, 'banks', bankId, 'mnemosyne.db'),
    path.join(rootMnemosyneDataDir, `${bankId}.db`),
  ]
}

export function getMnemosyneDbPath(bankId = getDefaultBankId()): string {
  const candidates = getCandidateDbPaths(bankId)
  const existing = candidates.find((candidate) => fs.existsSync(candidate))
  return existing ?? candidates[0]
}

function openReadonlyDb(dbPath: string): Database.Database {
  return new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  })
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ? LIMIT 1",
    )
    .get(tableName) as { 1?: number } | undefined
  return Boolean(row)
}

function countRows(db: Database.Database, tableName: string): number {
  if (!tableExists(db, tableName)) {
    throw new Error(`Mnemosyne schema missing required table: ${tableName}`)
  }
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM ${tableName}`)
    .get() as { count?: number }
  if (typeof row.count !== 'number' || !Number.isFinite(row.count)) {
    throw new Error(`Invalid count result for table: ${tableName}`)
  }
  return row.count
}

function countOptionalRows(db: Database.Database, tableName: string): number {
  if (!tableExists(db, tableName)) return 0
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM ${tableName}`)
    .get() as { count?: number }
  if (typeof row.count !== 'number' || !Number.isFinite(row.count)) {
    throw new Error(`Invalid count result for optional table: ${tableName}`)
  }
  return row.count
}

export function getMnemosyneStats(bankId = getDefaultBankId()): MnemosyneStats {
  const dbPath = getMnemosyneDbPath(bankId)
  if (!fs.existsSync(dbPath)) {
    return {
      checkedAt: Date.now(),
      db: { exists: false },
      counts: { working: 0, episodic: 0, triples: 0, fts: 0, total: 0 },
      missingReason: `Mnemosyne database not found for bank '${bankId}'`,
    }
  }

  const db = openReadonlyDb(dbPath)
  try {
    const working = countRows(db, 'working_memory')
    const episodic = countRows(db, 'episodic_memory')
    const triples = countRows(db, 'triples')
    const fts =
      countOptionalRows(db, 'fts_working') +
      countOptionalRows(db, 'fts_episodes')

    return {
      checkedAt: Date.now(),
      db: { exists: true },
      counts: {
        working,
        episodic,
        triples,
        fts,
        total: working + episodic,
      },
    }
  } finally {
    db.close()
  }
}
