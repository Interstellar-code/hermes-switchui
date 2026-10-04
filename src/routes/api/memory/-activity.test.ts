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
import { Route } from './activity'

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

const call = (qs = '') =>
  get({ request: new Request(`http://localhost/api/memory/activity?${qs}`) })

const day = (ago: number) =>
  new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10)

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchui-activity-'))
  const dbPath = path.join(dir, 'mnemosyne.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE working_memory (id TEXT PRIMARY KEY, content TEXT, created_at TIMESTAMP);
    CREATE TABLE episodic_memory (id TEXT PRIMARY KEY, content TEXT, created_at TIMESTAMP);
    CREATE TABLE gists (id TEXT PRIMARY KEY, text TEXT, created_at TIMESTAMP);
    CREATE TABLE facts (fact_id TEXT PRIMARY KEY, subject TEXT, predicate TEXT, object TEXT, timestamp TEXT, created_at TIMESTAMP);
    CREATE TABLE annotations (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT, kind TEXT, value TEXT, created_at TIMESTAMP);
  `)
  const w = db.prepare('INSERT INTO working_memory VALUES (?, ?, ?)')
  w.run('w1', 'a', `${day(0)} 10:00:00`)
  w.run('w2', 'b', `${day(0)} 11:00:00`)
  w.run('late', 'e', `${day(1)} 23:00:00`) // 23:00Z = next local day at +120
  w.run('w3', 'c', `${day(2)} 11:00:00`)
  w.run('old', 'd', `${day(90)} 11:00:00`) // outside window, still in totals
  db.prepare('INSERT INTO gists VALUES (?, ?, ?)').run(
    'g1',
    't',
    `${day(0)} 09:00:00`,
  )
  const f = db.prepare('INSERT INTO facts VALUES (?, ?, ?, ?, ?, ?)')
  f.run('f1', 'Rohit', 'likes', 'foxes', 't', `${day(1)} 09:00:00`)
  f.run('j1', 'If there', 'is', 'genuinely', 't', `${day(1)} 09:00:00`)
  db.prepare(
    'INSERT INTO annotations (memory_id, kind, value, created_at) VALUES (?, ?, ?, ?)',
  ).run('w1', 'mentions', 'Fox', `${day(0)} 10:00:00`)
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

describe('GET /api/memory/activity', () => {
  it('rejects unauthenticated requests', () => {
    auth.ok = false
    expect(call().status).toBe(401)
  })

  it('validates days and profile', () => {
    expect(call('tz=900').status).toBe(400)
    expect(call('tz=1.5').status).toBe(400)
    expect(call('days=0').status).toBe(400)
    expect(call('days=x').status).toBe(400)
    expect(call('profile=../etc').status).toBe(400)
  })

  it('returns zero-filled days, per-type counts, totals and junk', async () => {
    const res = call('days=7')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.days).toHaveLength(7)
    expect(body.days.at(-1)).toEqual({
      date: day(0),
      count: 3,
      byType: { gist: 1, fact: 0, episodic: 0, working: 2 },
    })
    expect(body.days.at(-2).byType).toMatchObject({ fact: 2, working: 1 })
    expect(body.days.at(-3).byType.working).toBe(1)
    expect(body.days[0].count).toBe(0)
    expect(body.totals).toEqual({
      gist: 1,
      fact: 2,
      entity: 1,
      episodic: 0,
      working: 5,
    })
    expect(body.junkFacts).toBe(1)
  })

  it('buckets by local day for tz=+120', async () => {
    const body = await call('days=7&tz=120').json()
    // 23:00Z yesterday is 01:00 today locally.
    const today = body.days.at(-1)
    const yesterday = body.days.at(-2)
    expect(today.byType.working).toBe(3) // w1, w2 (10-11Z) + late
    expect(yesterday.byType.working).toBe(0)
    expect(body.days).toHaveLength(7)
  })
})
