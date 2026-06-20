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

function createDb(schema: { withFts?: boolean; withTriples?: boolean } = {}) {
  const dbDir = path.join(tempRoot, 'mnemosyne', 'data')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'default.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE working_memory (id INTEGER PRIMARY KEY, content TEXT);
    CREATE TABLE episodic_memory (id INTEGER PRIMARY KEY, content TEXT);
    ${schema.withTriples === false ? '' : 'CREATE TABLE triples (id INTEGER PRIMARY KEY, subject TEXT);'}
    ${schema.withFts === false ? '' : 'CREATE TABLE fts_working (rowid INTEGER PRIMARY KEY, content TEXT);'}
    ${schema.withFts === false ? '' : 'CREATE TABLE fts_episodes (rowid INTEGER PRIMARY KEY, content TEXT);'}
  `)
  db.exec(`
    INSERT INTO working_memory (content) VALUES ('a'), ('b');
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
  })

  it('returns zero FTS rows when optional FTS tables are absent', async () => {
    createDb({ withFts: false })
    const mod = await import('../mnemosyne-browser')
    const stats = mod.getMnemosyneStats()

    expect(stats.counts.fts).toBe(0)
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
})
