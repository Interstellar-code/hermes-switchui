import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildMemoryGraph } from '../memory-graph'

// buildMemoryGraph resolves its DB path via getMnemosyneDbPath(), which honors
// MNEMOSYNE_DB_PATH first. Point it at a temp fixture we control.

const LONG_GIST =
  'This is a very long gist text that certainly exceeds the sixty character server truncation ceiling by a wide margin.'

let dbPath: string
const created: Array<string> = []
const origEnv = process.env.MNEMOSYNE_DB_PATH

function makeDb(seed: (db: Database.Database) => void): string {
  const p = path.join(
    os.tmpdir(),
    `mmap-test-${Math.random().toString(36).slice(2)}.db`,
  )
  const db = new Database(p)
  db.exec(`
    CREATE TABLE graph_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL, target TEXT NOT NULL, edge_type TEXT NOT NULL,
      weight REAL DEFAULT 1.0, timestamp TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE gists (id TEXT PRIMARY KEY, text TEXT NOT NULL);
    CREATE TABLE facts (
      fact_id TEXT PRIMARY KEY, subject TEXT, predicate TEXT, object TEXT
    );
  `)
  seed(db)
  db.close()
  created.push(p)
  return p
}

beforeAll(() => {
  dbPath = makeDb((db) => {
    const edge = db.prepare(
      'INSERT INTO graph_edges (source, target, edge_type, weight, timestamp) VALUES (?,?,?,?,?)',
    )
    // duplicate ctx edge → dedup to occurrences=2, weight=MAX(1,2)=2
    edge.run('gist_a', 'fact_a_0', 'ctx', 1.0, '2026-01-01T00:00:00Z')
    edge.run('gist_a', 'fact_a_0', 'ctx', 2.0, '2026-01-02T00:00:00Z')
    // second ctx edge, later gist for ordering + limit tests
    edge.run('gist_b', 'fact_b_0', 'ctx', 1.0, '2026-03-01T00:00:00Z')
    // references edge (wiki→wiki)
    edge.run('index.md', 'entities/switchui.md', 'references', 1.0, '2026-02-01T00:00:00Z')

    db.prepare('INSERT INTO gists (id, text) VALUES (?,?)').run('gist_a', LONG_GIST)
    db.prepare('INSERT INTO gists (id, text) VALUES (?,?)').run('gist_b', 'short gist')
    db.prepare(
      'INSERT INTO facts (fact_id, subject, predicate, object) VALUES (?,?,?,?)',
    ).run('fact_a_0', 'User', 'has', 'caught')
    db.prepare(
      'INSERT INTO facts (fact_id, subject, predicate, object) VALUES (?,?,?,?)',
    ).run('fact_b_0', 'UI', 'is', 'downstream')
  })
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

describe('buildMemoryGraph', () => {
  it('deduplicates edges and aggregates occurrences + max weight', () => {
    const g = buildMemoryGraph({ edgeType: 'ctx' })
    const e = g.edges.find((x) => x.source === 'gist_a' && x.target === 'fact_a_0')
    expect(e).toBeDefined()
    expect(e!.occurrences).toBe(2)
    expect(e!.weight).toBe(2)
    expect(g.meta.rawEdgeCount).toBe(3) // 3 raw ctx rows
    expect(g.meta.edgeCount).toBe(2) // 2 unique ctx pairs
  })

  it('resolves gist labels from gists.text, truncated to <=60 chars', () => {
    const g = buildMemoryGraph({ edgeType: 'ctx' })
    const node = g.nodes.find((n) => n.id === 'gist_a')
    expect(node?.kind).toBe('gist')
    expect(node!.label.length).toBeLessThanOrEqual(60)
    expect(node!.label).not.toBe(LONG_GIST) // never returns raw content
    expect(node!.label.endsWith('…')).toBe(true)
  })

  it('resolves fact labels from subject/predicate/object', () => {
    const g = buildMemoryGraph({ edgeType: 'ctx' })
    const node = g.nodes.find((n) => n.id === 'fact_a_0')
    expect(node?.kind).toBe('fact')
    expect(node?.label).toBe('User has caught')
  })

  it('resolves wiki labels to basename without extension', () => {
    const g = buildMemoryGraph({ edgeType: 'references' })
    const node = g.nodes.find((n) => n.id === 'entities/switchui.md')
    expect(node?.kind).toBe('wiki')
    expect(node?.label).toBe('switchui')
  })

  it('filters by edgeType', () => {
    const ctx = buildMemoryGraph({ edgeType: 'ctx' })
    expect(ctx.edges.every((e) => e.edgeType === 'ctx')).toBe(true)
    const refs = buildMemoryGraph({ edgeType: 'references' })
    expect(refs.edges.every((e) => e.edgeType === 'references')).toBe(true)
    expect(refs.edges).toHaveLength(1)
  })

  it('filters by since timestamp', () => {
    const g = buildMemoryGraph({ edgeType: 'ctx', since: '2026-02-01T00:00:00Z' })
    // only the gist_b ctx edge (2026-03) survives; gist_a max ts is 2026-01-02
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0].source).toBe('gist_b')
  })

  it('applies limit and reports truncated', () => {
    const g = buildMemoryGraph({ limit: 1 })
    expect(g.edges).toHaveLength(1)
    expect(g.meta.truncated).toBe(true)
    const full = buildMemoryGraph({})
    expect(full.meta.truncated).toBe(false)
  })

  it('returns edges in stable order (edge_type, source, target)', () => {
    const g = buildMemoryGraph({})
    const keys = g.edges.map((e) => `${e.edgeType}|${e.source}|${e.target}`)
    expect(keys).toEqual([...keys].sort())
  })

  it('never returns a label longer than 60 chars', () => {
    const g = buildMemoryGraph({})
    for (const n of g.nodes) expect(n.label.length).toBeLessThanOrEqual(60)
  })

  it('returns an empty graph with dbMissing when the DB file is absent', () => {
    process.env.MNEMOSYNE_DB_PATH = path.join(os.tmpdir(), 'does-not-exist-xyz.db')
    const g = buildMemoryGraph({})
    expect(g.nodes).toHaveLength(0)
    expect(g.edges).toHaveLength(0)
    expect(g.meta.dbMissing).toBe(true)
  })

  it('falls back to id-based labels when gists/facts tables are missing', () => {
    const bare = makeDbWithoutLabelTables()
    process.env.MNEMOSYNE_DB_PATH = bare
    const g = buildMemoryGraph({ edgeType: 'ctx' })
    const node = g.nodes.find((n) => n.id === 'gist_z')
    expect(node?.kind).toBe('gist')
    expect(node?.label).toBe('gist_z') // no gists table → id fallback
    expect(g.meta.dbMissing).toBe(false)
  })
})

function makeDbWithoutLabelTables(): string {
  const p = path.join(
    os.tmpdir(),
    `mmap-bare-${Math.random().toString(36).slice(2)}.db`,
  )
  const db = new Database(p)
  db.exec(`
    CREATE TABLE graph_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL, target TEXT NOT NULL, edge_type TEXT NOT NULL,
      weight REAL DEFAULT 1.0, timestamp TEXT
    );
  `)
  db.prepare(
    'INSERT INTO graph_edges (source, target, edge_type) VALUES (?,?,?)',
  ).run('gist_z', 'fact_z_0', 'ctx')
  db.close()
  created.push(p)
  return p
}
