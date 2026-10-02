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
import { toFtsQuery } from '../../../server/mnemosyne-browser'
import { Route } from './browse'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: unknown) => ({ options }),
}))

const auth = vi.hoisted(() => ({ ok: true }))
vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: () => auth.ok,
}))

type GetHandler = (context: { request: Request }) => Response
const get = (
  Route as unknown as { options: { server: { handlers: { GET: GetHandler } } } }
).options.server.handlers.GET

type Page = {
  items: Array<{
    id: string
    type: string
    text: string
    createdAt: string | null
  }>
  nextCursor: string | null
}

async function browse(
  qs: string,
): Promise<{ status: number; body: Page & { error?: string } }> {
  const res = get({
    request: new Request(`http://localhost/api/memory/browse?${qs}`),
  })
  return {
    status: res.status,
    body: (await res.json()) as Page & { error?: string },
  }
}

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchui-browse-'))
  const dbPath = path.join(dir, 'mnemosyne.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE working_memory (id TEXT PRIMARY KEY, content TEXT NOT NULL, created_at TIMESTAMP);
    CREATE VIRTUAL TABLE fts_working USING fts5(id UNINDEXED, content);
    CREATE TABLE episodic_memory (rowid INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, content TEXT NOT NULL, created_at TIMESTAMP);
    CREATE VIRTUAL TABLE fts_episodes USING fts5(content, content='episodic_memory', content_rowid='rowid');
    CREATE TABLE gists (id TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TIMESTAMP);
    CREATE TABLE facts (fact_id TEXT PRIMARY KEY, subject TEXT, predicate TEXT, object TEXT, timestamp TEXT, created_at TIMESTAMP);
    CREATE VIRTUAL TABLE fts_facts USING fts5(subject, predicate, object, content='facts');
    CREATE TABLE annotations (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT, kind TEXT, value TEXT, created_at TIMESTAMP);
  `)
  const w = db.prepare('INSERT INTO working_memory VALUES (?, ?, ?)')
  const wf = db.prepare('INSERT INTO fts_working (id, content) VALUES (?, ?)')
  for (let i = 0; i < 5; i++) {
    const content = i === 2 ? 'the quick brown fox' : `working note ${i}`
    w.run(`w${i}`, content, `2026-01-0${i + 1} 10:00:00`)
    wf.run(`w${i}`, content)
  }
  db.prepare(
    'INSERT INTO episodic_memory (id, content, created_at) VALUES (?, ?, ?)',
  ).run('e1', 'episode about foxes "quoted" OR NOT', '2026-02-01 10:00:00')
  db.exec(
    `INSERT INTO fts_episodes (rowid, content) SELECT rowid, content FROM episodic_memory`,
  )
  db.prepare('INSERT INTO gists VALUES (?, ?, ?)').run(
    'g1',
    'gist with 100% fox',
    '2026-03-01 10:00:00',
  )
  const fact = db.prepare('INSERT INTO facts VALUES (?, ?, ?, ?, ?, ?)')
  // f0 is first by (timestamp, fact_id) → canonical id/text; the row's date
  // is the group's newest created_at (f1's)
  fact.run(
    'f1',
    'Rohit',
    'likes',
    'fox',
    '2026-01-15T12:00:00',
    '2026-01-15 10:00:00',
  )
  fact.run(
    'f0',
    'rohit ',
    'likes',
    ' Fox',
    '2026-01-09T12:00:00',
    '2026-01-10 10:00:00',
  )
  // junk fragment → hidden, like on the Map
  fact.run(
    'j1',
    'If there',
    'is',
    'genuinely',
    '2026-01-16T12:00:00',
    '2026-01-16 10:00:00',
  )
  db.exec(
    `INSERT INTO fts_facts (rowid, subject, predicate, object) SELECT rowid, subject, predicate, object FROM facts`,
  )
  const a = db.prepare(
    'INSERT INTO annotations (memory_id, kind, value, created_at) VALUES (?, ?, ?, ?)',
  )
  a.run('w1', 'mentions', 'Fox', '2026-01-20 10:00:00')
  a.run('w2', 'mentions', 'Fox', '2026-01-21 10:00:00')
  a.run('w3', 'topic', 'ignored', '2026-01-22 10:00:00')
  db.close()
  process.env.MNEMOSYNE_DB_PATH = dbPath
})

afterAll(() => {
  delete process.env.MNEMOSYNE_DB_PATH
  fs.rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  auth.ok = true
})

describe('GET /api/memory/browse', () => {
  it('rejects unauthenticated requests', async () => {
    auth.ok = false
    expect((await browse('')).status).toBe(401)
  })

  it('lists all types recent-first', async () => {
    const { status, body } = await browse('limit=50')
    expect(status).toBe(200)
    expect(body.items.map((i) => i.id)).toEqual([
      'g1',
      'e1',
      'entity:Fox',
      'f0',
      'w4',
      'w3',
      'w2',
      'w1',
      'w0',
    ])
    expect(body.items[0].createdAt).toBe('2026-03-01T10:00:00.000Z')
    expect(body.nextCursor).toBeNull()
  })

  it('collapses identical facts into their first row and hides junk', async () => {
    const { body } = await browse('type=fact')
    expect(body.items).toEqual([
      {
        id: 'f0',
        type: 'fact',
        text: 'rohit likes Fox', // f0's own text (whitespace collapsed)
        createdAt: '2026-01-15T10:00:00.000Z',
      },
    ])
  })

  it('paginates with an opaque keyset cursor', async () => {
    const first = await browse('type=working&limit=2')
    expect(first.body.items.map((i) => i.id)).toEqual(['w4', 'w3'])
    expect(first.body.nextCursor).toEqual(expect.any(String))
    const second = await browse(
      `type=working&limit=2&cursor=${first.body.nextCursor}`,
    )
    expect(second.body.items.map((i) => i.id)).toEqual(['w2', 'w1'])
    const last = await browse(
      `type=working&limit=2&cursor=${second.body.nextCursor}`,
    )
    expect(last.body.items.map((i) => i.id)).toEqual(['w0'])
    expect(last.body.nextCursor).toBeNull()
  })

  it('does not shift pages when rows are written between them', async () => {
    const first = await browse('type=working&limit=2')
    const db = new Database(process.env.MNEMOSYNE_DB_PATH)
    db.prepare('INSERT INTO working_memory VALUES (?, ?, ?)').run(
      'wNew',
      'brand new',
      '2026-01-31 10:00:00',
    )
    db.close()
    try {
      const second = await browse(
        `type=working&limit=2&cursor=${first.body.nextCursor}`,
      )
      expect(second.body.items.map((i) => i.id)).toEqual(['w2', 'w1'])
    } finally {
      const cleanup = new Database(process.env.MNEMOSYNE_DB_PATH)
      cleanup.prepare("DELETE FROM working_memory WHERE id = 'wNew'").run()
      cleanup.close()
    }
  })

  it('filters by type and since', async () => {
    const { body } = await browse('type=working&since=2026-01-04T00:00:00Z')
    expect(body.items.map((i) => i.id)).toEqual(['w4', 'w3'])
    expect(body.items.every((i) => i.type === 'working')).toBe(true)
  })

  it('LIKE fallback ANDs words and escapes wildcards', async () => {
    const both = await browse(`q=${encodeURIComponent('fox gist')}`)
    expect(both.body.items.map((i) => i.id)).toEqual(['g1'])
    const pct = await browse(`q=${encodeURIComponent('100% fox')}`)
    expect(pct.body.items.map((i) => i.id)).toEqual(['g1'])
  })

  it('searches via FTS (prefix) and LIKE fallbacks', async () => {
    const { body } = await browse('q=fox')
    expect(body.items.map((i) => i.id).sort()).toEqual(
      ['e1', 'entity:Fox', 'f0', 'g1', 'w2'].sort(),
    )
  })

  it('treats FTS syntax in q as plain words', async () => {
    const quoted = await browse(`q=${encodeURIComponent('"quoted" OR NOT')}`)
    expect(quoted.status).toBe(200)
    expect(quoted.body.items.map((i) => i.id)).toEqual(['e1'])
    const junk = await browse(`q=${encodeURIComponent('content: ( * ^')}`)
    expect(junk.status).toBe(200)
    const symbols = await browse(`q=${encodeURIComponent('%%%')}`)
    expect(symbols.body.items).toEqual([])
  })

  it('validates params', async () => {
    expect((await browse('type=bogus')).status).toBe(400)
    expect((await browse('limit=0')).status).toBe(400)
    expect((await browse('cursor=garbage')).status).toBe(400)
    expect((await browse('since=notadate')).status).toBe(400)
  })
})

describe('toFtsQuery', () => {
  it('quotes each word and prefix-matches the last', () => {
    expect(toFtsQuery('foo bar')).toBe('"foo" "bar"*')
    expect(toFtsQuery('a"b OR c*')).toBe('"a" "b" "OR" "c"*')
    expect(toFtsQuery('  !!! ')).toBeNull()
  })
})
