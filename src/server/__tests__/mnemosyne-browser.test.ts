import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempRoot = ''
const originalEnv = { ...process.env }

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemosyne-browser-'))
  process.env = { ...originalEnv, HERMES_HOME: tempRoot }
  vi.resetModules()
})

afterEach(() => {
  process.env = { ...originalEnv }
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

function createDb(
  schema: { withFts?: boolean; withTriples?: boolean; stamped?: boolean } = {},
) {
  const dbDir = path.join(tempRoot, 'mnemosyne', 'data')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'default.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE working_memory (id INTEGER PRIMARY KEY, content TEXT${schema.stamped === false ? '' : ', created_at TIMESTAMP'});
    CREATE TABLE episodic_memory (id INTEGER PRIMARY KEY, content TEXT);
    ${schema.withTriples === false ? '' : 'CREATE TABLE triples (id INTEGER PRIMARY KEY, subject TEXT);'}
    ${schema.withFts === false ? '' : 'CREATE TABLE fts_working (rowid INTEGER PRIMARY KEY, content TEXT);'}
    ${schema.withFts === false ? '' : 'CREATE TABLE fts_episodes (rowid INTEGER PRIMARY KEY, content TEXT);'}
  `)
  db.exec(`
    ${schema.stamped === false ? "INSERT INTO working_memory (content) VALUES ('a'), ('b');" : "INSERT INTO working_memory (content, created_at) VALUES ('a', '2026-01-01 00:00:00'), ('b', '2026-02-03 04:05:06');"}
    INSERT INTO episodic_memory (content) VALUES ('c'), ('d'), ('e');
    ${schema.withTriples === false ? '' : "INSERT INTO triples (subject) VALUES ('x'), ('y');"}
    ${schema.withFts === false ? '' : "INSERT INTO fts_working (content) VALUES ('fw1'); INSERT INTO fts_episodes (content) VALUES ('fe1'), ('fe2');"}
  `)
  db.close()
}

describe('mnemosyne-browser', () => {
  it('resolves the default db path from HERMES_HOME', async () => {
    const mod = await import('../mnemosyne-browser')
    expect(mod.getMnemosyneDbPath()).toBe(
      path.join(
        tempRoot,
        'profiles',
        'hermes-switch',
        'matrix-memory',
        'data',
        'mnemosyne.db',
      ),
    )
  })

  it('prefers the hermes-switch profile matrix-memory db when present', async () => {
    const profileDataDir = path.join(
      tempRoot,
      'profiles',
      'hermes-switch',
      'matrix-memory',
      'data',
    )
    fs.mkdirSync(profileDataDir, { recursive: true })
    const dbPath = path.join(profileDataDir, 'mnemosyne.db')
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE working_memory (id INTEGER PRIMARY KEY, content TEXT);
      CREATE TABLE episodic_memory (id INTEGER PRIMARY KEY, content TEXT);
      CREATE TABLE triples (id INTEGER PRIMARY KEY, subject TEXT);
      CREATE TABLE fts_working (rowid INTEGER PRIMARY KEY, content TEXT);
      CREATE TABLE fts_episodes (rowid INTEGER PRIMARY KEY, content TEXT);
      INSERT INTO working_memory (content) VALUES ('a');
    `)
    db.close()

    const mod = await import('../mnemosyne-browser')
    expect(mod.getMnemosyneDbPath()).toBe(dbPath)
  })

  it('returns stats for a valid default-bank database', async () => {
    createDb()
    const mod = await import('../mnemosyne-browser')
    const stats = mod.getMnemosyneStats()

    expect(stats.db.exists).toBe(true)
    expect(stats.counts).toEqual({
      working: 2,
      episodic: 3,
      triples: 2,
      fts: 3,
      total: 5,
    })
    expect(typeof stats.checkedAt).toBe('number')
    // episodic_memory has no created_at here — it is skipped, not an error.
    expect(stats.lastWriteAt).toBe('2026-02-03T04:05:06.000Z')
  })

  it('returns zero FTS rows when optional FTS tables are absent', async () => {
    createDb({ withFts: false, stamped: false })
    const mod = await import('../mnemosyne-browser')
    const stats = mod.getMnemosyneStats()

    expect(stats.counts.fts).toBe(0)
    expect(stats.lastWriteAt).toBeNull()
  })

  it('returns an explicit missing-db payload when the db is absent', async () => {
    const mod = await import('../mnemosyne-browser')
    expect(mod.getMnemosyneStats()).toEqual({
      checkedAt: expect.any(Number),
      db: { exists: false },
      counts: { working: 0, episodic: 0, triples: 0, fts: 0, total: 0 },
      missingReason: "Mnemosyne database not found for bank 'default'",
    })
  })

  it('throws when a required schema table is missing', async () => {
    createDb({ withTriples: false })
    const mod = await import('../mnemosyne-browser')
    expect(() => mod.getMnemosyneStats()).toThrow(
      'Mnemosyne schema missing required table: triples',
    )
  })

  it('reports null health parts on a DB without consolidation/embedding schema', async () => {
    createDb()
    const mod = await import('../mnemosyne-browser')
    expect(mod.getMnemosyneStats().health).toEqual({
      lastConsolidation: null,
      backlog: null,
      embeddings: null,
    })
  })

  it('reports consolidation, backlog, backoff and embedding health', async () => {
    const dbDir = path.join(tempRoot, 'mnemosyne', 'data')
    fs.mkdirSync(dbDir, { recursive: true })
    const db = new Database(path.join(dbDir, 'default.db'))
    // Naive local-time isoformat, as the python plugin writes.
    const ago = (h: number) => {
      const d = new Date(Date.now() - h * 3_600_000)
      return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, -1)
    }
    db.exec(`
      CREATE TABLE working_memory (id TEXT PRIMARY KEY, content TEXT, timestamp TEXT,
        session_id TEXT, consolidated_at TEXT, consolidation_claimed_at TEXT, pinned INTEGER DEFAULT 0);
      CREATE TABLE episodic_memory (id INTEGER PRIMARY KEY, content TEXT);
      CREATE TABLE triples (id INTEGER PRIMARY KEY, subject TEXT);
      CREATE TABLE consolidation_log (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT,
        items_consolidated INTEGER, summary_preview TEXT, created_at TIMESTAMP);
      CREATE TABLE memory_embeddings (memory_id TEXT PRIMARY KEY, embedding_json TEXT NOT NULL);
    `)
    const ins = db.prepare(
      'INSERT INTO working_memory (id, timestamp, session_id, consolidated_at, consolidation_claimed_at, pinned) VALUES (?, ?, ?, ?, ?, ?)',
    )
    ins.run('old1', ago(100), 's1', null, null, 0) // eligible
    ins.run('old2', ago(100), 's2', null, ago(10), 0) // stale claim → eligible
    ins.run('old3', ago(100), null, null, null, 0) // eligible, 'default' session
    ins.run('fresh', ago(1), 's1', null, null, 0) // too young
    ins.run('pinned', ago(100), 's1', null, null, 1)
    ins.run('done', ago(100), 's1', ago(50), null, 0)
    ins.run('backoff', ago(100), 's3', null, ago(1), 0) // failed summary, backing off
    db.exec(`
      INSERT INTO consolidation_log (items_consolidated, summary_preview, created_at)
        VALUES (5, '1 summaries (llm) from 5 items', '2026-09-01T10:00:00'),
               (7, '2 summaries (aaak) from 7 items', '2026-09-02T10:00:00');
      INSERT INTO memory_embeddings VALUES ('old1', '[]'), ('done', '[]'), ('ghost', '[]');
    `)
    db.close()

    const mod = await import('../mnemosyne-browser')
    const health = mod.getMnemosyneStats().health!
    expect(health.lastConsolidation).toEqual({
      at: new Date('2026-09-02T10:00:00').toISOString(),
      method: 'aaak',
      items: 7,
    })
    expect(health.backlog).toEqual({ rows: 3, sessions: 3, backoff: 1 })
    expect(health.embeddings).toEqual({ covered: 2, total: 7 })
  })
})
