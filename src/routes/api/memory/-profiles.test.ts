import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  getProfileMatrixMemoryDir,
  isMemoryProfile,
} from '../../../server/memory-profile'
import { getMnemosyneDbPath } from '../../../server/mnemosyne-browser'
import { Route as ProfilesRoute } from './profiles'
import { Route as StatsRoute } from './stats'
import { Route as BrowseRoute } from './browse'
import { Route as GraphRoute } from './graph'
import { Route as SearchRoute } from './mnemosyne-search'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: unknown) => ({ options }),
}))
vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

type GetHandler = (context: { request: Request }) => Response
const handler = (route: unknown) =>
  (route as { options: { server: { handlers: { GET: GetHandler } } } }).options
    .server.handlers.GET

let home: string
let outside: string
const prevHome = process.env.HERMES_HOME
const prevDb = process.env.MNEMOSYNE_DB_PATH

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'switchui-mprof-'))
  process.env.HERMES_HOME = home
  delete process.env.MNEMOSYNE_DB_PATH
  // No profiles/hermes-switch dir: the legacy default must still be valid.
  for (const p of ['neo', 'trinity'])
    fs.mkdirSync(path.join(home, 'profiles', p), { recursive: true })
  fs.writeFileSync(path.join(home, 'profiles', 'not-a-dir'), 'x')
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'switchui-mprof-out-'))
  fs.symlinkSync(
    path.join(home, 'profiles', 'trinity'),
    path.join(home, 'profiles', 'inside-link'),
  )
  fs.symlinkSync(outside, path.join(home, 'profiles', 'escape-link'))
  const data = path.join(home, 'profiles', 'neo', 'matrix-memory', 'data')
  fs.mkdirSync(data, { recursive: true })
  const db = new Database(path.join(data, 'mnemosyne.db'))
  db.exec(
    "CREATE TABLE working_memory (id TEXT PRIMARY KEY, content TEXT, created_at TIMESTAMP); INSERT INTO working_memory VALUES ('w1','neo memory','2026-01-01 00:00:00');" +
      ' CREATE TABLE episodic_memory (id TEXT PRIMARY KEY, content TEXT, created_at TIMESTAMP);' +
      ' CREATE TABLE triples (id TEXT PRIMARY KEY);',
  )
  db.close()
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = prevHome
  if (prevDb !== undefined) process.env.MNEMOSYNE_DB_PATH = prevDb
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

describe('isMemoryProfile', () => {
  it('accepts existing profile dirs and the synthetic default', () => {
    expect(isMemoryProfile('neo')).toBe(true)
    expect(isMemoryProfile('hermes-switch')).toBe(true)
    expect(isMemoryProfile('default')).toBe(true)
  })

  it('rejects unknown profiles and non-directories', () => {
    expect(isMemoryProfile('ghost')).toBe(false)
    expect(isMemoryProfile('not-a-dir')).toBe(false)
    expect(isMemoryProfile('NEO')).toBe(false) // exact match only
  })

  it('accepts symlinked profiles only when they resolve inside HERMES_HOME', () => {
    expect(isMemoryProfile('inside-link')).toBe(true)
    expect(isMemoryProfile('escape-link')).toBe(false)
  })

  it('rejects traversal and malformed names', () => {
    for (const bad of [
      '..',
      '../neo',
      'neo/../trinity',
      'neo/',
      '/etc',
      '.hidden',
      '',
      'a'.repeat(65),
      'neo\0',
      42,
      null,
    ])
      expect(isMemoryProfile(bad)).toBe(false)
  })
})

describe('profile-scoped mnemosyne path', () => {
  it('reads the profile matrix-memory DB, default reads the root', () => {
    expect(getMnemosyneDbPath(undefined, 'neo')).toBe(
      path.join(
        home,
        'profiles',
        'neo',
        'matrix-memory',
        'data',
        'mnemosyne.db',
      ),
    )
    expect(getProfileMatrixMemoryDir('default')).toBe(
      path.join(home, 'matrix-memory'),
    )
  })
})

describe('memory routes with ?profile', () => {
  it('GET /api/memory/profiles lists profiles with matrix-memory presence', async () => {
    const res = handler(ProfilesRoute)({
      request: new Request('http://localhost/api/memory/profiles'),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      defaultProfile: string
      profiles: Array<{ name: string; hasMatrixMemory: boolean }>
    }
    expect(body.defaultProfile).toBe('hermes-switch')
    const byName = Object.fromEntries(
      body.profiles.map((p) => [p.name, p.hasMatrixMemory]),
    )
    expect(byName).toEqual({
      default: false,
      'hermes-switch': false,
      neo: true,
      trinity: false,
      'inside-link': false,
    })
  })

  it('stats/browse/graph 400 on unknown or traversal profiles', () => {
    for (const route of [StatsRoute, BrowseRoute, GraphRoute, SearchRoute]) {
      for (const p of ['ghost', '..%2Fneo', 'escape-link']) {
        const res = handler(route)({
          request: new Request(`http://localhost/api/memory/x?profile=${p}`),
        })
        expect(res.status).toBe(400)
      }
    }
  })

  it('stats + browse read the selected profile', async () => {
    const stats = (await handler(StatsRoute)({
      request: new Request('http://localhost/api/memory/stats?profile=neo'),
    }).json()) as { db: { exists: boolean } }
    expect(stats.db.exists).toBe(true)

    const missing = (await handler(StatsRoute)({
      request: new Request('http://localhost/api/memory/stats?profile=trinity'),
    }).json()) as { db: { exists: boolean } }
    expect(missing.db.exists).toBe(false)

    const page = (await handler(BrowseRoute)({
      request: new Request('http://localhost/api/memory/browse?profile=neo'),
    }).json()) as { items: Array<{ text: string }> }
    expect(page.items.map((i) => i.text)).toEqual(['neo memory'])
  })

  it('hermes-switch works without a profiles dir via MNEMOSYNE_DB_PATH', async () => {
    process.env.MNEMOSYNE_DB_PATH = getMnemosyneDbPath(undefined, 'neo')
    try {
      const res = handler(StatsRoute)({
        request: new Request(
          'http://localhost/api/memory/stats?profile=hermes-switch',
        ),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        db: { exists: boolean }
        counts: { working: number }
      }
      expect(body.db.exists).toBe(true)
      expect(body.counts.working).toBe(1)
    } finally {
      delete process.env.MNEMOSYNE_DB_PATH
    }
  })
})
