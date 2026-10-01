import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { Route } from './node'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: unknown) => ({ options }),
}))

const auth = vi.hoisted(() => ({ ok: true }))
vi.mock('../../../../server/auth-middleware', () => ({
  isAuthenticated: () => auth.ok,
}))

// readKnowledgePage is root-checked in production; stub it to one known page.
vi.mock('../../../../server/knowledge-browser', () => ({
  readKnowledgePage: (p: string) => {
    if (p !== 'entities/switchui.md') throw new Error('ENOENT')
    return {
      meta: {
        path: p,
        title: 'SwitchUI',
        created: '2026-01-01',
        modified: '2026-02-01T00:00:00.000Z',
      },
      content: '# SwitchUI\n\nFull page body.',
      backlinks: ['index.md'],
    }
  },
}))

type GetHandler = (context: { request: Request }) => Response
const get = (
  Route as unknown as { options: { server: { handlers: { GET: GetHandler } } } }
).options.server.handlers.GET

async function node(id: string | null, profile?: string) {
  let qs = id === null ? '' : `?id=${encodeURIComponent(id)}`
  if (profile !== undefined) qs += `&profile=${encodeURIComponent(profile)}`
  const res = get({
    request: new Request(`http://localhost/api/memory/graph/node${qs}`),
  })
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}

const LONG = `${'a long gist line '.repeat(10)}\nsecond line`
let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchui-graph-node-'))
  const dbPath = path.join(dir, 'mnemosyne.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE gists (id TEXT PRIMARY KEY, text TEXT, timestamp TEXT, location TEXT, created_at TIMESTAMP);
    CREATE TABLE working_memory (id TEXT PRIMARY KEY, content TEXT, source TEXT, importance REAL, binary_vector BLOB, created_at TIMESTAMP);
    CREATE TABLE facts (fact_id TEXT PRIMARY KEY, subject TEXT, predicate TEXT, object TEXT, confidence REAL, timestamp TEXT);
    CREATE TABLE episodic_memory (rowid INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, content TEXT, summary_of TEXT, created_at TIMESTAMP);
    CREATE TABLE annotations (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT, kind TEXT, value TEXT);
  `)
  db.prepare('INSERT INTO gists VALUES (?,?,?,?,?)').run(
    'gist_h1',
    LONG,
    null,
    'office',
    '2026-03-01 10:00:00',
  )
  db.prepare('INSERT INTO working_memory VALUES (?,?,?,?,?,?)').run(
    'w1',
    'working text',
    'chat',
    0.7,
    Buffer.from([1, 2]),
    '2026-03-02 10:00:00',
  )
  db.prepare('INSERT INTO facts VALUES (?,?,?,?,?,?)').run(
    'fact_h1_0',
    'Rohit',
    'likes',
    'SwitchUI',
    0.9,
    '2026-01-01T00:00:00Z',
  )
  db.prepare(
    'INSERT INTO episodic_memory (id, content, summary_of, created_at) VALUES (?,?,?,?)',
  ).run('e1', 'episode body', 'h1,w1', '2026-03-03 10:00:00')
  db.prepare(
    'INSERT INTO annotations (memory_id, kind, value) VALUES (?,?,?)',
  ).run('h1', 'mentions', 'SwitchUI')
  db.close()
  process.env.MNEMOSYNE_DB_PATH = dbPath
  // Profiles: hermes-switch (legacy chain → MNEMOSYNE_DB_PATH) and neo (no DB).
  for (const p of ['hermes-switch', 'neo'])
    fs.mkdirSync(path.join(dir, 'profiles', p), { recursive: true })
  prevHome = process.env.HERMES_HOME
  process.env.HERMES_HOME = dir
})

let prevHome: string | undefined

afterAll(() => {
  delete process.env.MNEMOSYNE_DB_PATH
  if (prevHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = prevHome
  fs.rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  auth.ok = true
})

describe('GET /api/memory/graph/node', () => {
  it('401s when unauthenticated', async () => {
    auth.ok = false
    expect((await node('gist_h1')).status).toBe(401)
  })

  it('400s without an id, 404s for unknown ids of every kind', async () => {
    expect((await node(null)).status).toBe(400)
    for (const id of [
      'gist_nope',
      'wm_nope',
      'fact_nope',
      'ep_nope',
      'entity:Nobody',
      'nope.md',
      '../../etc/passwd',
    ]) {
      expect((await node(id)).status, id).toBe(404)
    }
  })

  it('400s on unknown or traversal profiles', async () => {
    for (const p of ['ghost', '../neo', '..', ''])
      expect((await node('gist_h1', p)).status, p).toBe(400)
  })

  it('reads the selected profile DB', async () => {
    expect((await node('gist_h1', 'hermes-switch')).status).toBe(200)
    // neo exists but has no matrix-memory DB of its own.
    expect((await node('gist_h1', 'neo')).status).toBe(404)
  })

  it('returns full gist text with newlines and dates', async () => {
    const { status, body } = await node('gist_h1')
    expect(status).toBe(200)
    expect(body).toMatchObject({
      kind: 'gist',
      text: LONG,
      createdAt: '2026-03-01 10:00:00',
      source: { location: 'office' },
    })
    expect(body.label.length).toBeLessThanOrEqual(60)
  })

  it('resolves working, fact and episodic rows without leaking blobs', async () => {
    const w = await node('wm_w1')
    expect(w.body).toMatchObject({
      kind: 'working',
      text: 'working text',
      source: { source: 'chat', importance: 0.7 },
    })
    expect(w.body.source.binary_vector).toBeUndefined()

    const f = await node('fact_h1_0')
    expect(f.body).toMatchObject({
      kind: 'fact',
      text: 'Rohit likes SwitchUI',
      createdAt: '2026-01-01T00:00:00Z',
      source: { confidence: 0.9 },
    })

    const e = await node('ep_e1')
    expect(e.body).toMatchObject({
      kind: 'episodic',
      text: 'episode body',
      source: { summary_of: 'h1,w1' },
    })
  })

  it('summarises entities and reads wiki pages', async () => {
    const ent = await node('entity:SwitchUI')
    expect(ent.body).toMatchObject({
      kind: 'entity',
      text: 'SwitchUI',
      source: { facts: 1, mentions: 1, relations: 0 },
    })

    const wiki = await node('entities/switchui.md')
    expect(wiki.body).toMatchObject({
      kind: 'wiki',
      label: 'SwitchUI',
      text: '# SwitchUI\n\nFull page body.',
      createdAt: '2026-01-01',
      updatedAt: '2026-02-01T00:00:00.000Z',
      source: { backlinks: 1 },
    })
  })
})
