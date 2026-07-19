import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildMemoryGraph } from '../memory-graph'

// buildMemoryGraph resolves its DB via getMnemosyneDbPath(), which honors
// MNEMOSYNE_DB_PATH first. Point it at a temp fixture we control.

const LONG_GIST =
  'This is a very long gist text that certainly exceeds the sixty character server truncation ceiling by a wide margin.'

let fullDb: string
const created: Array<string> = []
const origEnv = process.env.MNEMOSYNE_DB_PATH

function newDbPath(prefix: string): string {
  const p = path.join(os.tmpdir(), `${prefix}-${Math.random().toString(36).slice(2)}.db`)
  created.push(p)
  return p
}

function buildFullFixture(): string {
  const p = newDbPath('mmap-full')
  const db = new Database(p)
  db.exec(`
    CREATE TABLE graph_edges (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, target TEXT, edge_type TEXT, weight REAL, timestamp TEXT);
    CREATE TABLE gists (id TEXT PRIMARY KEY, text TEXT);
    CREATE TABLE working_memory (id TEXT PRIMARY KEY, content TEXT);
    CREATE TABLE facts (fact_id TEXT PRIMARY KEY, subject TEXT, predicate TEXT, object TEXT, confidence REAL, timestamp TEXT);
    CREATE TABLE episodic_memory (id TEXT PRIMARY KEY, content TEXT, summary_of TEXT, timestamp TEXT);
    CREATE TABLE annotations (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT, kind TEXT, value TEXT, confidence REAL);
    CREATE TABLE memoria_kg (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT, object TEXT, confidence REAL);
  `)
  db.prepare('INSERT INTO gists (id, text) VALUES (?,?)').run('gist_h1', LONG_GIST)
  db.prepare('INSERT INTO gists (id, text) VALUES (?,?)').run('gist_h2', 'second gist')
  // working_memory: h1 duplicates a gist (must NOT create a node); w1 is working-only
  db.prepare('INSERT INTO working_memory (id, content) VALUES (?,?)').run('h1', 'dup of gist h1')
  db.prepare('INSERT INTO working_memory (id, content) VALUES (?,?)').run('w1', 'working only item')
  db.prepare(
    'INSERT INTO facts (fact_id, subject, predicate, object, confidence, timestamp) VALUES (?,?,?,?,?,?)',
  ).run('fact_h1_0', 'Rohit', 'likes', 'SwitchUI', 0.9, '2026-01-01T00:00:00Z')
  // ctx (duplicated → occurrences 2) + references
  const ge = db.prepare('INSERT INTO graph_edges (source, target, edge_type, weight, timestamp) VALUES (?,?,?,?,?)')
  ge.run('gist_h1', 'fact_h1_0', 'ctx', 1.0, '2026-01-01T00:00:00Z')
  ge.run('gist_h1', 'fact_h1_0', 'ctx', 2.0, '2026-01-02T00:00:00Z')
  ge.run('index.md', 'entities/switchui.md', 'references', 1.0, null)
  // mentions (memory → entity); note a non-mentions kind that must be ignored
  const an = db.prepare('INSERT INTO annotations (memory_id, kind, value, confidence) VALUES (?,?,?,?)')
  an.run('h1', 'mentions', 'SwitchUI', 0.8)
  an.run('h1', 'mentions', 'React', 0.7)
  an.run('w1', 'mentions', 'React', 0.6)
  an.run('h1', 'occurred_on', '2026-01-01', 1.0) // must be ignored
  // episodic summarizes memories h1 + h2
  db.prepare('INSERT INTO episodic_memory (id, content, summary_of, timestamp) VALUES (?,?,?,?)').run(
    'e1', 'episode content', 'h1,h2', '2026-02-01T00:00:00Z',
  )
  // relates (entity → entity)
  db.prepare('INSERT INTO memoria_kg (subject, object, confidence) VALUES (?,?,?)').run('Rohit', 'SwitchUI', 0.9)
  db.close()
  return p
}

function buildMinimalFixture(): string {
  const p = newDbPath('mmap-min')
  const db = new Database(p)
  db.exec(`
    CREATE TABLE graph_edges (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, target TEXT, edge_type TEXT, weight REAL, timestamp TEXT);
    CREATE TABLE gists (id TEXT PRIMARY KEY, text TEXT);
    CREATE TABLE facts (fact_id TEXT PRIMARY KEY, subject TEXT, predicate TEXT, object TEXT, confidence REAL, timestamp TEXT);
  `)
  db.prepare('INSERT INTO gists (id, text) VALUES (?,?)').run('gist_x', 'x gist')
  db.prepare('INSERT INTO facts (fact_id, subject, predicate, object) VALUES (?,?,?,?)').run(
    'fact_x_0', 'Alpha', 'is', 'Beta',
  )
  db.prepare('INSERT INTO graph_edges (source, target, edge_type, weight) VALUES (?,?,?,?)').run(
    'gist_x', 'fact_x_0', 'ctx', 1.0,
  )
  db.close()
  return p
}

const edgeKey = (g: ReturnType<typeof buildMemoryGraph>, type: string) =>
  g.edges.filter((e) => e.edgeType === type)

beforeAll(() => {
  fullDb = buildFullFixture()
  process.env.MNEMOSYNE_DB_PATH = fullDb
})
afterEach(() => {
  process.env.MNEMOSYNE_DB_PATH = fullDb
})
afterAll(() => {
  if (origEnv === undefined) delete process.env.MNEMOSYNE_DB_PATH
  else process.env.MNEMOSYNE_DB_PATH = origEnv
  for (const p of created) fs.rmSync(p, { force: true })
})

describe('buildMemoryGraph — full census', () => {
  it('dedups ctx edges and aggregates occurrences + max weight', () => {
    const g = buildMemoryGraph({ edgeType: 'ctx' })
    const e = g.edges.find((x) => x.source === 'gist_h1' && x.target === 'fact_h1_0')
    expect(e?.occurrences).toBe(2)
    expect(e?.weight).toBe(2)
  })

  it('builds mentions edges memory→entity, resolving the memory hash to its gist', () => {
    const g = buildMemoryGraph({ edgeType: 'mentions' })
    // h1 has a gist → gist_h1; w1 has no gist → wm_w1
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'gist_h1', target: 'entity:SwitchUI', edgeType: 'mentions' }))
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'wm_w1', target: 'entity:React', edgeType: 'mentions' }))
    // the non-mentions annotation kind is ignored
    expect(g.edges.every((e) => e.edgeType === 'mentions')).toBe(true)
  })

  it('builds about edges fact→entity for subject and object', () => {
    const about = edgeKey(buildMemoryGraph({ edgeType: 'about' }), 'about')
    expect(about).toContainEqual(expect.objectContaining({ source: 'fact_h1_0', target: 'entity:Rohit' }))
    expect(about).toContainEqual(expect.objectContaining({ source: 'fact_h1_0', target: 'entity:SwitchUI' }))
  })

  it('builds summarizes edges episodic→memory from summary_of hashes', () => {
    const s = edgeKey(buildMemoryGraph({ edgeType: 'summarizes' }), 'summarizes')
    expect(s).toContainEqual(expect.objectContaining({ source: 'ep_e1', target: 'gist_h1' }))
    expect(s).toContainEqual(expect.objectContaining({ source: 'ep_e1', target: 'gist_h2' }))
  })

  it('builds relates edges entity→entity from memoria_kg', () => {
    const r = edgeKey(buildMemoryGraph({ edgeType: 'relates' }), 'relates')
    expect(r).toContainEqual(expect.objectContaining({ source: 'entity:Rohit', target: 'entity:SwitchUI' }))
  })

  it('dedups memory by hash: working row with a gist is NOT a separate node', () => {
    const g = buildMemoryGraph({})
    const ids = new Set(g.nodes.map((n) => n.id))
    expect(ids.has('gist_h1')).toBe(true)
    expect(ids.has('wm_h1')).toBe(false) // h1 already a gist
    const wOnly = g.nodes.find((n) => n.id === 'wm_w1')
    expect(wOnly?.kind).toBe('working')
  })

  it('classifies node kinds', () => {
    const byId = new Map(buildMemoryGraph({}).nodes.map((n) => [n.id, n.kind]))
    expect(byId.get('gist_h1')).toBe('gist')
    expect(byId.get('fact_h1_0')).toBe('fact')
    expect(byId.get('entity:SwitchUI')).toBe('entity')
    expect(byId.get('ep_e1')).toBe('episodic')
    expect(byId.get('entities/switchui.md')).toBe('wiki')
  })

  it('truncates labels to <=60 chars and never returns raw gist text', () => {
    const g = buildMemoryGraph({})
    for (const n of g.nodes) expect(n.label.length).toBeLessThanOrEqual(60)
    const gist = g.nodes.find((n) => n.id === 'gist_h1')
    expect(gist?.label).not.toBe(LONG_GIST)
    expect(gist?.label.endsWith('…')).toBe(true)
  })

  it('filters by edgeType', () => {
    for (const t of ['ctx', 'references', 'mentions', 'about', 'relates', 'summarizes'] as const) {
      const g = buildMemoryGraph({ edgeType: t })
      expect(g.edges.every((e) => e.edgeType === t)).toBe(true)
    }
  })

  it('returns edges in stable sorted order', () => {
    const keys = buildMemoryGraph({}).edges.map((e) => `${e.edgeType}|${e.source}|${e.target}`)
    expect(keys).toEqual([...keys].sort())
  })

  it('applies limit + reports truncated', () => {
    const g = buildMemoryGraph({ limit: 1 })
    expect(g.edges).toHaveLength(1)
    expect(g.meta.truncated).toBe(true)
  })
})

describe('buildMemoryGraph — resilience', () => {
  it('returns dbMissing when the file is absent', () => {
    process.env.MNEMOSYNE_DB_PATH = path.join(os.tmpdir(), 'nope-xyz.db')
    const g = buildMemoryGraph({})
    expect(g.meta.dbMissing).toBe(true)
    expect(g.nodes).toHaveLength(0)
  })

  it('works with only graph_edges/gists/facts present (optional tables missing)', () => {
    const min = buildMinimalFixture()
    process.env.MNEMOSYNE_DB_PATH = min
    const g = buildMemoryGraph({})
    expect(g.meta.dbMissing).toBe(false)
    // ctx + about survive; mentions/summarizes/relates skipped (no tables)
    expect(g.edges.some((e) => e.edgeType === 'ctx')).toBe(true)
    expect(g.edges.some((e) => e.edgeType === 'about')).toBe(true)
    expect(g.edges.some((e) => e.edgeType === 'mentions')).toBe(false)
  })
})
