import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { searchMnemosyne } from '../mnemosyne-browser'

const LONG =
  'Subshero is a subscription tracking SaaS. '.repeat(20) // > 400 chars to test truncation

let dbPath: string
const created: Array<string> = []
const origEnv = process.env.MNEMOSYNE_DB_PATH

function makeDb(withLabelTables: boolean): string {
  const p = path.join(os.tmpdir(), `mnemo-search-${Math.random().toString(36).slice(2)}.db`)
  const db = new Database(p)
  if (withLabelTables) {
    db.exec(`
      CREATE TABLE gists (id TEXT PRIMARY KEY, text TEXT);
      CREATE TABLE facts (fact_id TEXT PRIMARY KEY, subject TEXT, predicate TEXT, object TEXT);
      CREATE TABLE episodic_memory (id TEXT PRIMARY KEY, content TEXT);
    `)
    db.prepare('INSERT INTO gists (id, text) VALUES (?,?)').run('gist_1', LONG)
    db.prepare('INSERT INTO gists (id, text) VALUES (?,?)').run('gist_2', 'Thailand trip planned for 2026')
    db.prepare('INSERT INTO gists (id, text) VALUES (?,?)').run('gist_3', 'unrelated note about cats')
    db.prepare('INSERT INTO facts (fact_id, subject, predicate, object) VALUES (?,?,?,?)').run(
      'fact_1', 'Subshero', 'is', 'a SaaS project',
    )
    db.prepare('INSERT INTO episodic_memory (id, content) VALUES (?,?)').run(
      'ep_1', 'Episode about the Thailand itinerary',
    )
  } else {
    // graph_edges present but no label tables — search must tolerate this
    db.exec('CREATE TABLE graph_edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, edge_type TEXT)')
  }
  db.close()
  created.push(p)
  return p
}

beforeAll(() => {
  dbPath = makeDb(true)
  process.env.MNEMOSYNE_DB_PATH = dbPath
})
afterEach(() => {
  process.env.MNEMOSYNE_DB_PATH = dbPath
})
afterAll(() => {
  if (origEnv === undefined) delete process.env.MNEMOSYNE_DB_PATH
  else process.env.MNEMOSYNE_DB_PATH = origEnv
  for (const p of created) fs.rmSync(p, { force: true })
})

describe('searchMnemosyne', () => {
  it('ranks matches by number of distinct query terms and returns kinds', () => {
    const r = searchMnemosyne('Subshero SaaS project')
    expect(r.length).toBeGreaterThan(0)
    // fact "Subshero is a SaaS project" hits 3 terms → should rank at/near top
    const top = r[0]
    expect(top.score).toBeGreaterThanOrEqual(2)
    expect(['gist', 'fact', 'episodic']).toContain(top.kind)
  })

  it('matches across gists, facts, and episodic', () => {
    const r = searchMnemosyne('Thailand')
    const kinds = new Set(r.map((m) => m.kind))
    expect(kinds.has('gist')).toBe(true) // "Thailand trip planned"
    expect(kinds.has('episodic')).toBe(true) // "Thailand itinerary"
  })

  it('excludes non-matching rows', () => {
    const r = searchMnemosyne('Subshero')
    expect(r.every((m) => m.text.toLowerCase().includes('subshero'))).toBe(true)
  })

  it('truncates snippets to <=400 chars', () => {
    const r = searchMnemosyne('subscription')
    for (const m of r) expect(m.text.length).toBeLessThanOrEqual(400)
  })

  it('respects the limit', () => {
    expect(searchMnemosyne('subscription Thailand Subshero', 1).length).toBe(1)
  })

  it('returns [] for an empty / too-short query', () => {
    expect(searchMnemosyne('')).toEqual([])
    expect(searchMnemosyne('a to')).toEqual([]) // terms < 3 chars dropped
  })

  it('returns [] when the DB file is absent', () => {
    process.env.MNEMOSYNE_DB_PATH = path.join(os.tmpdir(), 'nope-mnemo.db')
    expect(searchMnemosyne('anything')).toEqual([])
  })

  it('tolerates missing label tables', () => {
    process.env.MNEMOSYNE_DB_PATH = makeDb(false)
    expect(searchMnemosyne('anything')).toEqual([])
  })
})

describe('searchMnemosyne via FTS5', () => {
  function makeFtsDb(): string {
    const p = path.join(os.tmpdir(), `mnemo-fts-${Math.random().toString(36).slice(2)}.db`)
    const db = new Database(p)
    db.exec(`
      CREATE TABLE gists (id TEXT PRIMARY KEY, text TEXT);
      CREATE TABLE facts (fact_id TEXT PRIMARY KEY, subject TEXT, predicate TEXT, object TEXT);
      CREATE VIRTUAL TABLE fts_facts USING fts5(subject, predicate, object, content='facts');
      CREATE TABLE episodic_memory (rowid INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, content TEXT);
      CREATE VIRTUAL TABLE fts_episodes USING fts5(content, content='episodic_memory', content_rowid='rowid');
    `)
    const ep = db.prepare('INSERT INTO episodic_memory (id, content) VALUES (?, ?)')
    ep.run('e1', 'Met Rohit at the café near the station')
    ep.run('e2', 'Ünïcode handling fixed in the parser')
    ep.run('e3', '記憶検索の改善について話した')
    // Indexed text diverges from the row: proves results come from the FTS
    // index, not a scan of episodic_memory.content.
    ep.run('e4', 'plain row text')
    db.exec(`INSERT INTO fts_episodes (rowid, content) SELECT rowid, content FROM episodic_memory WHERE id != 'e4'`)
    db.prepare("INSERT INTO fts_episodes (rowid, content) SELECT rowid, 'zebracorn indexed only' FROM episodic_memory WHERE id = 'e4'").run()
    db.prepare('INSERT INTO facts VALUES (?, ?, ?, ?)').run('f1', 'Rohit', 'drinks', 'café au lait')
    db.exec('INSERT INTO fts_facts (rowid, subject, predicate, object) SELECT rowid, subject, predicate, object FROM facts')
    db.prepare('INSERT INTO gists VALUES (?, ?)').run('g1', 'Notes on the café menu')
    db.close()
    created.push(p)
    return p
  }

  it('reads matches from the FTS index', () => {
    process.env.MNEMOSYNE_DB_PATH = makeFtsDb()
    const r = searchMnemosyne('zebracorn')
    expect(r).toEqual([{ kind: 'episodic', text: 'plain row text', score: 1 }])
  })

  it('matches accented words, folded like unicode61 (cafe ↔ café)', () => {
    process.env.MNEMOSYNE_DB_PATH = makeFtsDb()
    const kinds = searchMnemosyne('cafe').map((m) => m.kind).sort()
    expect(kinds).toEqual(['episodic', 'fact', 'gist'])
    const r = searchMnemosyne('café')
    expect(new Set(r.map((m) => m.kind))).toEqual(new Set(['episodic', 'fact', 'gist']))
    expect(searchMnemosyne('Ünïcode')[0].text).toContain('parser')
  })

  it('falls back to LIKE for unspaced CJK the FTS tokenizer cannot split', () => {
    process.env.MNEMOSYNE_DB_PATH = makeFtsDb()
    const r = searchMnemosyne('検索')
    expect(r).toHaveLength(1)
    expect(r[0].kind).toBe('episodic')
    expect(r[0].text).toContain('記憶検索')
  })

  it('ranks gist LIKE matches by words matched before the cap', () => {
    const p = makeFtsDb()
    const db = new Database(p)
    const g = db.prepare('INSERT INTO gists VALUES (?, ?)')
    for (let i = 0; i < 60; i++) g.run(`weak${i}`, `alpha filler ${i}`)
    g.run('best', 'alpha beta gamma together') // last by rowid
    db.close()
    process.env.MNEMOSYNE_DB_PATH = p
    const r = searchMnemosyne('alpha beta gamma', 8)
    expect(r[0]).toEqual({ kind: 'gist', text: 'alpha beta gamma together', score: 3 })
  })

  it('folds accents/case on gists (cafe ↔ café)', () => {
    process.env.MNEMOSYNE_DB_PATH = makeFtsDb()
    expect(searchMnemosyne('CAFE').some((m) => m.kind === 'gist')).toBe(true)
  })

  it('mixed Latin + CJK query also LIKE-searches the CJK word', () => {
    process.env.MNEMOSYNE_DB_PATH = makeFtsDb()
    const texts = searchMnemosyne('parser 検索').map((m) => m.text)
    expect(texts.some((t) => t.includes('parser'))).toBe(true)
    expect(texts.some((t) => t.includes('記憶検索'))).toBe(true)
  })

  it('treats FTS operators in the query as plain words', () => {
    process.env.MNEMOSYNE_DB_PATH = makeFtsDb()
    expect(() => searchMnemosyne('"NEAR( AND OR* content:')).not.toThrow()
  })
})
