import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { buildMemoryGraph, isJunkFact } from '../memory-graph'
import { getMemoryGraphNode } from '../memory-graph-node'

// Keep the wiki source deterministic: the real one reads the user's config.
const wikiPages = vi.hoisted(() => ({
  list: [{ path: 'index.md' }, { path: 'orphan-page.md' }],
}))
vi.mock('../knowledge-browser', () => ({
  listKnowledgePages: () => wikiPages.list,
}))

// buildMemoryGraph resolves its DB via getMnemosyneDbPath(), which honors
// MNEMOSYNE_DB_PATH first. Point it at a temp fixture we control.

const LONG_GIST =
  'This is a very long gist text that certainly exceeds the sixty character server truncation ceiling by a wide margin.'

let fullDb: string
const created: Array<string> = []
const origEnv = process.env.MNEMOSYNE_DB_PATH

function newDbPath(prefix: string): string {
  const p = path.join(
    os.tmpdir(),
    `${prefix}-${Math.random().toString(36).slice(2)}.db`,
  )
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
  db.prepare('INSERT INTO gists (id, text) VALUES (?,?)').run(
    'gist_h1',
    LONG_GIST,
  )
  db.prepare('INSERT INTO gists (id, text) VALUES (?,?)').run(
    'gist_h2',
    'second gist',
  )
  // working_memory: h1 duplicates a gist (must NOT create a node); w1 is working-only
  db.prepare('INSERT INTO working_memory (id, content) VALUES (?,?)').run(
    'h1',
    'dup of gist h1',
  )
  db.prepare('INSERT INTO working_memory (id, content) VALUES (?,?)').run(
    'w1',
    'working only item',
  )
  db.prepare(
    'INSERT INTO facts (fact_id, subject, predicate, object, confidence, timestamp) VALUES (?,?,?,?,?,?)',
  ).run('fact_h1_0', 'Rohit', 'likes', 'SwitchUI', 0.9, '2026-01-01T00:00:00Z')
  // ctx (duplicated → occurrences 2) + references
  const ge = db.prepare(
    'INSERT INTO graph_edges (source, target, edge_type, weight, timestamp) VALUES (?,?,?,?,?)',
  )
  ge.run('gist_h1', 'fact_h1_0', 'ctx', 1.0, '2026-01-01T00:00:00Z')
  ge.run('gist_h1', 'fact_h1_0', 'ctx', 2.0, '2026-01-02T00:00:00Z')
  ge.run('index.md', 'entities/switchui.md', 'references', 1.0, null)
  // mentions (memory → entity); note a non-mentions kind that must be ignored
  const an = db.prepare(
    'INSERT INTO annotations (memory_id, kind, value, confidence) VALUES (?,?,?,?)',
  )
  an.run('h1', 'mentions', 'SwitchUI', 0.8)
  an.run('h1', 'mentions', 'React', 0.7)
  an.run('w1', 'mentions', 'React', 0.6)
  an.run('h1', 'occurred_on', '2026-01-01', 1.0) // must be ignored
  an.run('h1', 'mentions', 'Re', 0.9) // stopword entity → dropped
  an.run('h1', 'mentions', 'Users', 0.9) // stopword entity → dropped
  an.run('h1', 'mentions', 'Go', 0.9) // < 3 chars → dropped
  an.run('h1', 'mentions', 'ONLY', 0.9) // stopword, case-insensitive
  an.run('h1', 'mentions', 'PR', 0.5) // acronym kept…
  an.run('w1', 'mentions', 'PR', 0.5) // …seen twice
  an.run('h1', 'mentions', 'Lonely', 0.5) // single mention → dropped
  // episodic summarizes memories h1 + h2
  db.prepare(
    'INSERT INTO episodic_memory (id, content, summary_of, timestamp) VALUES (?,?,?,?)',
  ).run('e1', 'episode content', 'h1,h2', '2026-02-01T00:00:00Z')
  // relates (entity → entity)
  db.prepare(
    'INSERT INTO memoria_kg (subject, object, confidence) VALUES (?,?,?)',
  ).run('Rohit', 'SwitchUI', 0.9)
  db.prepare(
    'INSERT INTO memoria_kg (subject, object, confidence) VALUES (?,?,?)',
  ).run('Done', 'Yes', 0.9)
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
  db.prepare('INSERT INTO gists (id, text) VALUES (?,?)').run(
    'gist_x',
    'x gist',
  )
  db.prepare(
    'INSERT INTO facts (fact_id, subject, predicate, object) VALUES (?,?,?,?)',
  ).run('fact_x_0', 'Alpha', 'is', 'Beta')
  db.prepare(
    'INSERT INTO graph_edges (source, target, edge_type, weight) VALUES (?,?,?,?)',
  ).run('gist_x', 'fact_x_0', 'ctx', 1.0)
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
    const e = g.edges.find(
      (x) => x.source === 'gist_h1' && x.target === 'fact_h1_0',
    )
    expect(e?.occurrences).toBe(2)
    expect(e?.weight).toBe(2)
  })

  it('builds mentions edges memory→entity, resolving the memory hash to its gist', () => {
    const g = buildMemoryGraph({ edgeType: 'mentions' })
    // h1 has a gist → gist_h1; w1 has no gist → wm_w1
    expect(g.edges).toContainEqual(
      expect.objectContaining({
        source: 'gist_h1',
        target: 'entity:SwitchUI',
        edgeType: 'mentions',
      }),
    )
    expect(g.edges).toContainEqual(
      expect.objectContaining({
        source: 'wm_w1',
        target: 'entity:React',
        edgeType: 'mentions',
      }),
    )
    // the non-mentions annotation kind is ignored
    expect(g.edges.every((e) => e.edgeType === 'mentions')).toBe(true)
  })

  it('builds about edges fact→entity for subject and object', () => {
    const about = edgeKey(buildMemoryGraph({ edgeType: 'about' }), 'about')
    expect(about).toContainEqual(
      expect.objectContaining({ source: 'fact_h1_0', target: 'entity:Rohit' }),
    )
    expect(about).toContainEqual(
      expect.objectContaining({
        source: 'fact_h1_0',
        target: 'entity:SwitchUI',
      }),
    )
  })

  it('builds summarizes edges episodic→memory from summary_of hashes', () => {
    const s = edgeKey(
      buildMemoryGraph({ edgeType: 'summarizes' }),
      'summarizes',
    )
    expect(s).toContainEqual(
      expect.objectContaining({ source: 'ep_e1', target: 'gist_h1' }),
    )
    expect(s).toContainEqual(
      expect.objectContaining({ source: 'ep_e1', target: 'gist_h2' }),
    )
  })

  it('builds relates edges entity→entity from memoria_kg', () => {
    const r = edgeKey(buildMemoryGraph({ edgeType: 'relates' }), 'relates')
    expect(r).toContainEqual(
      expect.objectContaining({
        source: 'entity:Rohit',
        target: 'entity:SwitchUI',
      }),
    )
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
    for (const t of [
      'ctx',
      'references',
      'mentions',
      'about',
      'relates',
      'summarizes',
    ] as const) {
      const g = buildMemoryGraph({ edgeType: t })
      expect(g.edges.every((e) => e.edgeType === t)).toBe(true)
    }
  })

  it('returns edges in stable sorted order', () => {
    const keys = buildMemoryGraph({}).edges.map(
      (e) => `${e.edgeType}|${e.source}|${e.target}`,
    )
    expect(keys).toEqual([...keys].sort())
  })

  it('applies limit + reports truncated', () => {
    const g = buildMemoryGraph({ limit: 1 })
    expect(g.edges).toHaveLength(1)
    expect(g.meta.truncated).toBe(true)
  })
})

describe('buildMemoryGraph — fair truncation, pruning, wiki, stopwords', () => {
  it('a tight limit keeps every edge type and reports byType/droppedByType', () => {
    const full = buildMemoryGraph({})
    const g = buildMemoryGraph({ limit: 6 })
    const types = new Set(full.edges.map((e) => e.edgeType))
    expect(types.size).toBe(6)
    expect(new Set(g.edges.map((e) => e.edgeType))).toEqual(types)
    for (const t of types) expect(g.meta.byType[t]).toBe(1)
    const dropped = Object.values(g.meta.droppedByType).reduce(
      (a, b) => a + b,
      0,
    )
    expect(dropped).toBe(full.edges.length - 6)
    expect(g.meta.truncated).toBe(true)
    expect(full.meta.truncated).toBe(false)
  })

  it('within a type the cut keeps the highest-weight edges', () => {
    const g = buildMemoryGraph({ edgeType: 'mentions', limit: 1 })
    expect(g.edges).toEqual([
      expect.objectContaining({ target: 'entity:SwitchUI' }),
    ])
  })

  it('prunes nodes left without edges, except wiki pages', () => {
    const g = buildMemoryGraph({ limit: 6 })
    const linked = new Set(g.edges.flatMap((e) => [e.source, e.target]))
    for (const n of g.nodes)
      if (n.kind !== 'wiki') expect(linked.has(n.id)).toBe(true)
    // gist_h2 is only reachable via summarizes; with mentions-only it is gone
    const m = buildMemoryGraph({ edgeType: 'mentions' })
    expect(m.nodes.some((n) => n.id === 'gist_h2')).toBe(false)
  })

  it('includes every wiki page as a node even without links, ids = wiki paths', () => {
    const g = buildMemoryGraph({})
    const wiki = g.nodes.filter((n) => n.kind === 'wiki').map((n) => n.id)
    expect(wiki).toEqual(
      expect.arrayContaining([
        'index.md',
        'orphan-page.md',
        'entities/switchui.md',
      ]),
    )
    expect(wiki.filter((id) => id === 'index.md')).toHaveLength(1) // no dup with edge node
    expect(g.nodes.find((n) => n.id === 'orphan-page.md')?.label).toBe(
      'orphan-page',
    )
  })

  it('limit below type count still gives the rarest types one edge each', () => {
    const g = buildMemoryGraph({ limit: 3 })
    expect(g.edges).toHaveLength(3)
    expect(new Set(g.edges.map((e) => e.edgeType)).size).toBe(3)
  })

  it('cut is deterministic across calls', () => {
    const ids = (lim: number) =>
      buildMemoryGraph({ limit: lim }).edges.map(
        (e) => `${e.source}>${e.target}`,
      )
    expect(ids(7)).toEqual(ids(7))
  })

  it('keeps acronyms, drops single-mention entities, counts junk in meta', () => {
    const g = buildMemoryGraph({})
    const ids = new Set(g.nodes.map((n) => n.id))
    expect(ids.has('entity:PR')).toBe(true)
    expect(ids.has('entity:Lonely')).toBe(false)
    expect(ids.has('entity:ONLY')).toBe(false)
    // fact subject with degree 1 survives (Rohit only appears in relates)
    expect(ids.has('entity:Rohit')).toBe(true)
    expect(g.meta.junkDropped).toBe(6) // Re, Users, Go, ONLY, Done→Yes, Lonely
    expect(g.meta.rawEdgeCount).toBeGreaterThanOrEqual(
      g.edges.length + g.meta.junkDropped,
    )
  })

  it('drops stopword / short entities and every edge touching them', () => {
    const g = buildMemoryGraph({})
    const ids = new Set(g.nodes.map((n) => n.id))
    for (const junk of [
      'entity:Re',
      'entity:Users',
      'entity:Go',
      'entity:Done',
      'entity:Yes',
    ]) {
      expect(ids.has(junk)).toBe(false)
      expect(g.edges.some((e) => e.source === junk || e.target === junk)).toBe(
        false,
      )
    }
    expect(ids.has('entity:React')).toBe(true)
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

describe('isJunkFact', () => {
  it.each([
    ['If there', 'is', 'genuinely'],
    ['So this', 'is', 'genuinely'],
    ['Below', 'is', 'what'],
    ['Discussion', 'is', 'not'],
    ['How the runner', 'uses', 'this'],
    ['The build', 'is', 'lready'],
    ['Why this', 'is', 'important'],
    ['Okay so', 'is', 'fine'],
    ['The router', 'is', 'multi'],
    ['It', 'runs', 'quickly'],
  ])('junk: %s | %s | %s', (s, p, o) => {
    expect(isJunkFact(s, p, o)).toBe(true)
  })
  it.each([
    ['Rohit', 'works_at', 'Interstellar Code'],
    ['Circuit breaker', 'uses', 'native'],
    ['Each signal file', 'has', 'YAML'],
    ['Sreeharsha Hanumanthu', 'is', 'Trainee'],
    ['Therapist', 'is', 'helpful'], // "the…" prefix is not the filler "the"
    ['Task', 'is', 'done'], // stopword, but allowlisted
    ['Rohit', 'has', 'family'], // -ly noun, allowlisted
    ['Trip', 'is', 'Italy'],
  ])('keep: %s | %s | %s', (s, p, o) => {
    expect(isJunkFact(s, p, o)).toBe(false)
  })
})

describe('fact dedupe + junk filter', () => {
  function dupFixture(): string {
    const p = newDbPath('mmap-dup')
    const db = new Database(p)
    db.exec(`
      CREATE TABLE graph_edges (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, target TEXT, edge_type TEXT, weight REAL, timestamp TEXT);
      CREATE TABLE facts (fact_id TEXT PRIMARY KEY, subject TEXT, predicate TEXT, object TEXT, confidence REAL, timestamp TEXT, created_at TIMESTAMP);
    `)
    const ins = db.prepare(
      'INSERT INTO facts (fact_id, subject, predicate, object, confidence, timestamp, created_at) VALUES (?,?,?,?,?,?,?)',
    )
    // created_at (UTC) drives "Seen"; timestamp only orders canonical rows
    const f = {
      run: (...a: [string, string, string, string, number, string]) =>
        ins.run(...a, a[5].replace('T', ' ').slice(0, 19)),
    }
    f.run('fact_f1', 'Rohit', 'likes', 'SwitchUI', 1, '2026-01-01T00:00:00Z')
    f.run('fact_f2', ' rohit ', 'LIKES', 'switchui', 1, '2026-03-01T00:00:00Z')
    f.run('fact_f3', 'Rohit', ' likes ', 'SwitchUI ', 1, '2026-02-01T00:00:00Z')
    f.run('fact_j1', 'If there', 'is', 'genuinely', 1, '2026-01-01T00:00:00Z')
    f.run('fact_j2', 'If there', 'is', 'genuinely', 1, '2026-01-02T00:00:00Z')
    const ge = db.prepare(
      'INSERT INTO graph_edges (source, target, edge_type, weight) VALUES (?,?,?,?)',
    )
    ge.run('gist_a', 'fact_f2', 'ctx', 1) // follows f2 onto the canonical fact_f1
    ge.run('gist_a', 'fact_j1', 'ctx', 1) // junk fact → edge dropped
    ge.run('fact_f3', 'gist_a', 'ctx', 1) // alias in ensureNode → no stray f3
    // exact-name entity: 'rohit' (lowercase) must not pull in 'Rohit' facts
    f.run('fact_r', 'rohit', 'owns', 'Laptop', 1, '2026-04-01T00:00:00Z')
    db.close()
    return p
  }

  it('collapses 3 identical facts into 1 node with count + date range', () => {
    process.env.MNEMOSYNE_DB_PATH = dupFixture()
    const g = buildMemoryGraph({})
    const facts = g.nodes.filter((n) => n.kind === 'fact' && n.id !== 'fact_r')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      id: 'fact_f1',
      count: 3,
      firstAt: '2026-01-01 00:00:00',
      lastAt: '2026-03-01 00:00:00',
      factIds: ['fact_f1', 'fact_f3', 'fact_f2'],
    })
    const about = g.edges.find(
      (e) => e.edgeType === 'about' && e.target === 'entity:Rohit',
    )
    expect(about?.occurrences).toBe(3)
    // both ctx edges (to f2, from f3) land on the canonical f1
    const ctx = g.edges.filter((e) => e.edgeType === 'ctx')
    expect(ctx.map((e) => [e.source, e.target]).sort()).toEqual([
      ['fact_f1', 'gist_a'],
      ['gist_a', 'fact_f1'],
    ])
    expect(g.nodes.some((n) => n.id === 'fact_f2' || n.id === 'fact_f3')).toBe(
      false,
    )
    expect(g.meta.duplicateFacts).toBe(2)
  })

  it('hides junk facts, counts them, and prunes their only entities', () => {
    process.env.MNEMOSYNE_DB_PATH = dupFixture()
    const g = buildMemoryGraph({})
    const ids = new Set(g.nodes.map((n) => n.id))
    expect(g.meta.junkFacts).toBe(2)
    expect(ids.has('fact_j1')).toBe(false)
    expect(ids.has('entity:genuinely')).toBe(false)
    expect(ids.has('entity:If there')).toBe(false)
    expect(g.edges.some((e) => e.target === 'fact_j1')).toBe(false)
  })

  it('node detail groups identical facts for entities and facts', () => {
    process.env.MNEMOSYNE_DB_PATH = dupFixture()
    const ent = getMemoryGraphNode('entity:Rohit')
    expect(ent?.facts).toEqual([
      {
        id: 'fact_f1',
        text: 'Rohit likes SwitchUI',
        count: 3,
        firstAt: '2026-01-01 00:00:00',
        lastAt: '2026-03-01 00:00:00',
      },
    ])
    expect(getMemoryGraphNode('fact_f3')).toMatchObject({
      count: 3,
      firstAt: '2026-01-01 00:00:00',
      lastAt: '2026-03-01 00:00:00',
    })
    expect(ent?.source).toMatchObject({ facts: 3, distinct_facts: 1 })
    // exact (trimmed) name like the graph: 'rohit' gets only its own fact
    expect(getMemoryGraphNode('entity:rohit')?.facts?.map((f) => f.id)).toEqual(
      ['fact_r'],
    )
    // only junk facts name it → unknown node
    expect(getMemoryGraphNode('entity:genuinely')).toBeNull()
  })
})
