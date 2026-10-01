import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getHermesRoot } from './claude-paths'
import {
  DEFAULT_MEMORY_PROFILE,
  getProfileMatrixMemoryDir,
} from './memory-profile'

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
  /** ISO time of the newest working/episodic row, if any. */
  lastWriteAt?: string | null
  missingReason?: string
}

function getDefaultBankId(): string {
  const fromEnv = process.env.MNEMOSYNE_BANK_ID?.trim()
  if (fromEnv) return fromEnv
  return 'default'
}

function getCandidateDbPaths(
  bankId = getDefaultBankId(),
  profile?: string,
): Array<string> {
  // A non-default profile reads only its own DB — env overrides and root
  // fallbacks describe the legacy (hermes-switch) install.
  if (profile && profile !== DEFAULT_MEMORY_PROFILE) {
    const dataDir = path.join(getProfileMatrixMemoryDir(profile), 'data')
    return [
      bankId === 'default'
        ? path.join(dataDir, 'mnemosyne.db')
        : path.join(dataDir, 'banks', bankId, 'mnemosyne.db'),
    ]
  }

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
    getProfileMatrixMemoryDir(DEFAULT_MEMORY_PROFILE),
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

export function getMnemosyneDbPath(
  bankId = getDefaultBankId(),
  profile?: string,
): string {
  const candidates = getCandidateDbPaths(bankId, profile)
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

function hasColumn(
  db: Database.Database,
  tableName: string,
  column: string,
): boolean {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string
  }>
  return cols.some((c) => c.name === column)
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

export function getMnemosyneStats(
  bankId = getDefaultBankId(),
  profile?: string,
): MnemosyneStats {
  const dbPath = getMnemosyneDbPath(bankId, profile)
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

    // Only tables that actually carry created_at (schemas vary across versions).
    const stamped = ['working_memory', 'episodic_memory'].filter((t) =>
      hasColumn(db, t, 'created_at'),
    )
    const last = stamped.length
      ? (db
          .prepare(
            `SELECT MAX(ts) AS ts FROM (${stamped
              .map((t) => `SELECT MAX(created_at) AS ts FROM ${t}`)
              .join(' UNION ALL ')})`,
          )
          .get() as { ts: string | null })
      : { ts: null }

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
      lastWriteAt: sqliteTsToIso(last.ts),
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

/** Lowercase + strip diacritics, matching FTS5 unicode61's default folding. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function scoreText(text: string, terms: Array<string>): number {
  const haystack = fold(text)
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

type SearchSource = {
  kind: MnemosyneSearchMatch['kind']
  table: string
  /** Row text expression over alias `t`. */
  text: string
  /** FTS5 index whose rowid joins `t.rowid`; absent → LIKE only. */
  fts?: string
}

const SEARCH_SOURCES: Array<SearchSource> = [
  { kind: 'gist', table: 'gists', text: 't.text' },
  {
    kind: 'fact',
    table: 'facts',
    text: "COALESCE(t.subject, '') || ' ' || COALESCE(t.predicate, '') || ' ' || COALESCE(t.object, '')",
    fts: 'fts_facts',
  },
  { kind: 'episodic', table: 'episodic_memory', text: 't.content', fts: 'fts_episodes' },
]

/**
 * Read-only keyword search over the profile's mnemosyne memory (gists, facts,
 * episodic summaries). Uses the FTS5 indexes (any term, bm25-ranked) where they
 * exist; gists have none → escaped per-word LIKE on accent/case-folded text,
 * ranked by words matched. unicode61 doesn't split unspaced scripts (CJK/Thai),
 * so non-Latin words also run through LIKE on FTS tables. Each source reads at
 * most `limit * 5` candidates per method,
 * re-scored by distinct terms matched; snippets capped at SEARCH_SNIPPET_MAX.
 * Grounds the Memory chat. Returns [] when the DB or a table is absent.
 */
export function searchMnemosyne(
  query: string,
  limit = 8,
  bankId = getDefaultBankId(),
  profile?: string,
): Array<MnemosyneSearchMatch> {
  // Latin words < 3 chars are noise ("a", "to"); one CJK char is a word.
  const words = searchWords(query).filter(
    (w) => w.length >= 3 || /[^\p{ASCII}]/u.test(w),
  )
  if (words.length === 0) return []
  const terms = [...new Set(words.map(fold))]

  const dbPath = getMnemosyneDbPath(bankId, profile)
  if (!fs.existsSync(dbPath)) return []

  const cap = Math.max(1, limit) * 5
  // Any word matches; only the last is prefix-matched (as in browse).
  const ftsQuery = words
    .map((w, i) => (i === words.length - 1 ? toFtsQuery(w) : `"${w}"`))
    .join(' OR ')
  // unicode61 can't split unspaced scripts (CJK/Thai): those words also go
  // through LIKE, even when FTS found rows for the others.
  const nonLatinWords = words.filter((w) => /[^\p{Script=Latin}\p{N}_]/u.test(w))

  const db = openReadonlyDb(dbPath)
  /** Rows whose folded text contains any of `ws`, most words matched first. */
  const likeRows = (s: SearchSource, ws: Array<string>) => {
    const params = Object.fromEntries(ws.map((w, i) => [`w${i}`, toLikePattern(fold(w))]))
    const hits = ws.map((_, i) => `(f LIKE @w${i} ESCAPE '\\')`)
    return db
      .prepare(
        `SELECT text FROM (SELECT ${s.text} AS text, fold(${s.text}) AS f FROM ${s.table} t)
         WHERE ${hits.join(' OR ')} ORDER BY ${hits.join(' + ')} DESC LIMIT @cap`,
      )
      .all({ ...params, cap }) as Array<{ text: string | null }>
  }
  try {
    db.function('fold', { deterministic: true }, (v: unknown) => fold(String(v ?? '')))
    const matches: Array<MnemosyneSearchMatch> = []
    for (const s of SEARCH_SOURCES) {
      if (!tableExists(db, s.table)) continue
      let rows: Array<{ text: string | null }> = []
      if (s.fts && tableExists(db, s.fts)) {
        rows = db
          .prepare(
            `SELECT ${s.text} AS text FROM ${s.fts} JOIN ${s.table} t ON t.rowid = ${s.fts}.rowid
             WHERE ${s.fts} MATCH @q ORDER BY ${s.fts}.rank LIMIT @cap`,
          )
          .all({ q: ftsQuery, cap }) as typeof rows
        if (nonLatinWords.length > 0) {
          const seen = new Set(rows.map((r) => r.text))
          rows.push(...likeRows(s, nonLatinWords).filter((r) => !seen.has(r.text)))
        }
      } else {
        rows = likeRows(s, words)
      }
      for (const r of rows) {
        if (!r.text) continue
        // FTS hits always match ≥1 term even when folding/prefixing differs.
        const score = Math.max(1, scoreText(r.text, terms))
        matches.push({ kind: s.kind, text: snippet(r.text), score })
      }
    }

    matches.sort((a, b) => b.score - a.score)
    return matches.slice(0, Math.max(1, limit))
  } finally {
    db.close()
  }
}

// ── Browse ────────────────────────────────────────────────────────────────────

export const MNEMOSYNE_BROWSE_TYPES = [
  'gist',
  'fact',
  'entity',
  'episodic',
  'working',
] as const
export type MnemosyneBrowseType = (typeof MNEMOSYNE_BROWSE_TYPES)[number]

export function isMnemosyneBrowseType(v: unknown): v is MnemosyneBrowseType {
  return MNEMOSYNE_BROWSE_TYPES.includes(v as MnemosyneBrowseType)
}

export type MnemosyneBrowseItem = {
  id: string
  type: MnemosyneBrowseType
  text: string
  createdAt: string | null
}

export type MnemosyneBrowsePage = {
  items: Array<MnemosyneBrowseItem>
  /** Opaque keyset cursor for the next page; null when exhausted. */
  nextCursor: string | null
}

export type MnemosyneBrowseOptions = {
  type?: MnemosyneBrowseType | null
  q?: string
  /** ISO date/time; only rows written at or after it. */
  since?: string | null
  limit?: number
  /** `nextCursor` from the previous page. */
  cursor?: string | null
  /** Validated profile name; absent = legacy hermes-switch paths. */
  profile?: string
}

/** Searchable words in free text (letters/digits/_), capped at 12. */
function searchWords(q: string): Array<string> {
  return (q.match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 12)
}

/**
 * Turn free text into a safe FTS5 MATCH expression: every word becomes a
 * quoted phrase (so FTS operators / column filters / quotes in user input are
 * inert), ANDed together, last word prefix-matched. Null = no searchable words.
 */
export function toFtsQuery(q: string): string | null {
  const words = searchWords(q)
  if (words.length === 0) return null
  return words.map((w, i) => `"${w}"${i === words.length - 1 ? '*' : ''}`).join(' ')
}

/** LIKE pattern with %, _ and \ escaped (use with ESCAPE '\'). */
function toLikePattern(word: string): string {
  return `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

type Cursor = [ts: string, type: string, id: string]

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url')
}

/** Null when malformed. */
export function decodeCursor(raw: string): Cursor | null {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as unknown
    return Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === 'string')
      ? (c as Cursor)
      : null
  } catch {
    return null
  }
}

/** ISO → sqlite CURRENT_TIMESTAMP shape ('YYYY-MM-DD HH:MM:SS', UTC). */
function toSqliteTs(iso: string): string | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

function sqliteTsToIso(ts: string | null): string | null {
  if (!ts) return null
  const ms = Date.parse(`${ts.replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? '' : 'Z'}`)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

type BrowseSource = {
  type: MnemosyneBrowseType
  table: string
  /** SELECT … yielding (id, type, text, ts); `f` is the q clause (or ''). */
  sql: (f: string) => string
  /** q clause via an FTS table, when that table exists. */
  fts?: { table: string; clause: string }
  /** text expression for the per-word LIKE fallback. */
  likeExpr: string
}

const BROWSE_SOURCES: Array<BrowseSource> = [
  {
    type: 'gist',
    table: 'gists',
    sql: (f) => `SELECT g.id AS id, 'gist' AS type, g.text AS text, g.created_at AS ts FROM gists g WHERE 1=1 ${f}`,
    likeExpr: 'g.text',
  },
  {
    type: 'fact',
    table: 'facts',
    sql: (f) =>
      `SELECT f.fact_id AS id, 'fact' AS type, f.subject || ' ' || f.predicate || ' ' || f.object AS text, f.created_at AS ts FROM facts f WHERE 1=1 ${f}`,
    fts: { table: 'fts_facts', clause: 'f.rowid IN (SELECT rowid FROM fts_facts WHERE fts_facts MATCH @fts)' },
    likeExpr: "(f.subject || ' ' || f.predicate || ' ' || f.object)",
  },
  {
    type: 'entity',
    table: 'annotations',
    sql: (f) =>
      `SELECT 'entity:' || a.value AS id, 'entity' AS type, a.value AS text, MAX(a.created_at) AS ts FROM annotations a WHERE a.kind = 'mentions' ${f} GROUP BY a.value`,
    likeExpr: 'a.value',
  },
  {
    type: 'episodic',
    table: 'episodic_memory',
    sql: (f) => `SELECT e.id AS id, 'episodic' AS type, e.content AS text, e.created_at AS ts FROM episodic_memory e WHERE 1=1 ${f}`,
    fts: { table: 'fts_episodes', clause: 'e.rowid IN (SELECT rowid FROM fts_episodes WHERE fts_episodes MATCH @fts)' },
    likeExpr: 'e.content',
  },
  {
    type: 'working',
    table: 'working_memory',
    sql: (f) => `SELECT w.id AS id, 'working' AS type, w.content AS text, w.created_at AS ts FROM working_memory w WHERE 1=1 ${f}`,
    fts: { table: 'fts_working', clause: 'w.id IN (SELECT id FROM fts_working WHERE fts_working MATCH @fts)' },
    likeExpr: 'w.content',
  },
]

/**
 * Read-only, recent-first page of mnemosyne rows across (or within) a type.
 * `q` uses the FTS5 tables where they exist (gists/entities have none → one
 * escaped LIKE per word, ANDed). Keyset pagination on (ts, type, id) so rows
 * written between pages never shift or duplicate results. Missing DB or
 * tables → empty page.
 */
export function browseMnemosyne(
  opts: MnemosyneBrowseOptions = {},
  bankId = getDefaultBankId(),
): MnemosyneBrowsePage {
  const empty: MnemosyneBrowsePage = { items: [], nextCursor: null }
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200)
  const words = searchWords(opts.q ?? '')
  if (opts.q?.trim() && words.length === 0) return empty
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null

  const dbPath = getMnemosyneDbPath(bankId, opts.profile)
  if (!fs.existsSync(dbPath)) return empty

  const db = openReadonlyDb(dbPath)
  try {
    const parts = BROWSE_SOURCES.filter(
      (s) => (!opts.type || s.type === opts.type) && tableExists(db, s.table),
    ).map((s) => {
      if (words.length === 0) return s.sql('')
      const clause =
        s.fts && tableExists(db, s.fts.table)
          ? s.fts.clause
          : words.map((_, i) => `${s.likeExpr} LIKE @w${i} ESCAPE '\\'`).join(' AND ')
      return s.sql(`AND ${clause}`)
    })
    if (parts.length === 0) return empty

    const params: Record<string, string | number | null> = {
      since: opts.since ? toSqliteTs(opts.since) : null,
      limit: limit + 1,
      cts: cursor?.[0] ?? null,
      ctype: cursor?.[1] ?? null,
      cid: cursor?.[2] ?? null,
    }
    if (words.length > 0) {
      params.fts = toFtsQuery(words.join(' '))
      words.forEach((w, i) => (params[`w${i}`] = toLikePattern(w)))
    }

    // ponytail: UNION ALL + ORDER BY scans every matching row of every type
    // per page (~10k rows today, a few ms). Per-type created_at indexes + a
    // k-way merge if the bank grows to 100k+.
    const rows = db
      .prepare(
        `SELECT id, type, text, ts FROM (
            SELECT id, type, text, COALESCE(ts, '') AS ts FROM (${parts.join(' UNION ALL ')})
          )
          WHERE (@since IS NULL OR ts >= @since)
            AND (@cts IS NULL OR (ts, type, id) < (@cts, @ctype, @cid))
          ORDER BY ts DESC, type DESC, id DESC
          LIMIT @limit`,
      )
      .all(params) as Array<{ id: string; type: MnemosyneBrowseType; text: string | null; ts: string }>

    const page = rows.slice(0, limit)
    const last = page.at(-1)
    return {
      items: page.map((r) => ({
        id: String(r.id),
        type: r.type,
        text: snippet(r.text),
        createdAt: sqliteTsToIso(r.ts),
      })),
      nextCursor:
        rows.length > limit && last ? encodeCursor([last.ts, last.type, String(last.id)]) : null,
    }
  } finally {
    db.close()
  }
}
