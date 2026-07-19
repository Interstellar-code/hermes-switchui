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

export type MnemosyneSearchMatch = {
  kind: 'gist' | 'fact' | 'episodic'
  text: string
  score: number
}

const SEARCH_SNIPPET_MAX = 400

function scoreText(text: string, terms: Array<string>): number {
  const haystack = text.toLowerCase()
  let score = 0
  for (const term of terms) if (haystack.includes(term)) score++
  return score
}

function snippet(text: unknown): string {
  const collapsed = String(text ?? '').replace(/\s+/g, ' ').trim()
  return collapsed.length > SEARCH_SNIPPET_MAX
    ? `${collapsed.slice(0, SEARCH_SNIPPET_MAX - 1)}…`
    : collapsed
}

/**
 * Read-only keyword search over the profile's mnemosyne memory (gists, facts,
 * episodic summaries). Scores each row by how many distinct query terms it
 * contains and returns the top matches with truncated snippets. Used to ground
 * the Memory chat — never returns full raw memory beyond SEARCH_SNIPPET_MAX.
 * Returns [] when the DB or a table is absent (never throws for a fresh profile).
 */
export function searchMnemosyne(
  query: string,
  limit = 8,
  bankId = getDefaultBankId(),
): Array<MnemosyneSearchMatch> {
  const terms = (query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).slice(0, 12)
  if (terms.length === 0) return []

  const dbPath = getMnemosyneDbPath(bankId)
  if (!fs.existsSync(dbPath)) return []

  const db = openReadonlyDb(dbPath)
  try {
    const matches: Array<MnemosyneSearchMatch> = []
    const consider = (kind: MnemosyneSearchMatch['kind'], text: string) => {
      if (!text) return
      const score = scoreText(text, terms)
      if (score > 0) matches.push({ kind, text: snippet(text), score })
    }

    if (tableExists(db, 'gists')) {
      for (const row of db.prepare('SELECT text FROM gists').iterate() as Iterable<{
        text: string
      }>) {
        consider('gist', row.text)
      }
    }
    if (tableExists(db, 'facts')) {
      for (const row of db
        .prepare('SELECT subject, predicate, object FROM facts')
        .iterate() as Iterable<{
        subject: string | null
        predicate: string | null
        object: string | null
      }>) {
        consider('fact', `${row.subject ?? ''} ${row.predicate ?? ''} ${row.object ?? ''}`)
      }
    }
    if (tableExists(db, 'episodic_memory')) {
      for (const row of db
        .prepare('SELECT content FROM episodic_memory')
        .iterate() as Iterable<{ content: string }>) {
        consider('episodic', row.content)
      }
    }

    matches.sort((a, b) => b.score - a.score)
    return matches.slice(0, Math.max(1, limit))
  } finally {
    db.close()
  }
}
