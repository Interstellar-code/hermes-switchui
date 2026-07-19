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
