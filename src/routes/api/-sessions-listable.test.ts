import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Route, isListableSession } from './sessions/listable'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts as object,
}))
const mocks = vi.hoisted(() => {
  const rows: Partial<Record<string, Record<string, unknown>>> = {}
  return { authed: true, rows, dashboardFetch: vi.fn() }
})
vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => mocks.authed,
}))
vi.mock('../../server/gateway-capabilities', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dashboardFetch: mocks.dashboardFetch,
}))

type Handler = (ctx: { request: Request }) => Promise<Response>
const GET = (Route as unknown as { server: { handlers: { GET: Handler } } })
  .server.handlers.GET
const get = (query: string) =>
  GET({
    request: new Request(`http://localhost/api/sessions/listable${query}`),
  })

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  source: 'telegram',
  title: id,
  started_at: 100,
  last_activity_at: 200,
  parent_session_id: null,
  end_reason: null,
  archived: 0,
  hidden: 0,
  model_config: null,
  ...over,
})

beforeEach(() => {
  mocks.authed = true
  mocks.rows = {
    root: row('root'),
    delegate: row('delegate', {
      source: 'recovered',
      model_config: '{"_delegate_from":"__orphaned__"}',
    }),
    archived: row('archived', { archived: 1 }),
    segment: row('segment', { end_reason: 'compression' }),
    tip: row('tip', { parent_session_id: 'segment' }),
    subagent: row('subagent', {
      parent_session_id: 'root',
      source: 'subagent',
    }),
    branch: row('branch', {
      parent_session_id: 'root',
      model_config: { _branched_from: 'root' },
    }),
    reset: row('reset', { parent_session_id: 'ended', session_key: 'k' }),
    ended: row('ended', { end_reason: 'session_reset', session_key: 'k' }),
  }
  mocks.dashboardFetch.mockReset().mockImplementation(async (path: string) => {
    const id = decodeURIComponent(path.split('/').pop()!.split('?')[0])
    const found = mocks.rows[id]
    return found
      ? { ok: true, json: async () => found }
      : { ok: false, status: 404, json: async () => ({}) }
  })
})

describe('GET /api/sessions/listable', () => {
  it('returns only rows the dashboard list would show, as list rows', async () => {
    const ids = Object.keys(mocks.rows).filter((id) => id !== 'ended')
    const res = await get(`?profile=work&ids=${[...ids, 'missing'].join(',')}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      sessions: Array<{ key: string; profile: string; updatedAt: number }>
    }
    expect(body.sessions.map((s) => s.key).sort()).toEqual([
      'branch',
      'reset',
      'root',
      'tip',
    ])
    expect(body.sessions[0].profile).toBe('work')
    expect(body.sessions.find((s) => s.key === 'root')!.updatedAt).toBe(200_000)
    expect(mocks.dashboardFetch).toHaveBeenCalledWith(
      '/api/sessions/root?profile=work',
      expect.anything(),
    )
  })

  it('rejects unauthenticated, invalid profiles and over-long id lists', async () => {
    mocks.authed = false
    expect((await get('?ids=a')).status).toBe(401)
    mocks.authed = true
    expect((await get('?profile=..%2Fx&ids=a')).status).toBe(400)
    const many = Array.from({ length: 101 }, (_, i) => `s${i}`).join(',')
    expect((await get(`?ids=${many}`)).status).toBe(400)
    expect(mocks.dashboardFetch).not.toHaveBeenCalled()
  })
})

describe('GET /api/sessions/listable — guards', () => {
  it.each(['.', '..', 'a/b', '../x', 'a%2Fb', '-'.repeat(129)])(
    'rejects id %s with 400 before any fetch',
    async (bad) => {
      const res = await get(`?ids=root,${encodeURIComponent(bad)}`)
      expect(res.status).toBe(400)
      expect(mocks.dashboardFetch).not.toHaveBeenCalled()
    },
  )

  it('never fetches a malformed parent id', async () => {
    mocks.rows.kid = row('kid', { parent_session_id: '../etc' })
    const body = (await (await get('?ids=kid')).json()) as {
      sessions: Array<unknown>
    }
    expect(body.sessions).toEqual([])
    expect(mocks.dashboardFetch).toHaveBeenCalledTimes(1)
  })

  it('503s when every detail read failed; one failure is just skipped', async () => {
    mocks.dashboardFetch.mockResolvedValue({ ok: false, status: 503 })
    expect((await get('?ids=root,branch')).status).toBe(503)
    mocks.dashboardFetch.mockImplementation(async (path: string) =>
      path.includes('root')
        ? { ok: true, json: async () => mocks.rows.root }
        : { ok: false, status: 503 },
    )
    const res = await get('?ids=root,branch')
    expect(res.status).toBe(200)
  })

  it('reads details with a timeout signal', async () => {
    await get('?ids=root')
    expect(mocks.dashboardFetch.mock.calls[0][1]).toEqual({
      signal: expect.any(AbortSignal),
    })
  })
})

describe('isListableSession', () => {
  it('a reset child needs the same routing key as its parent', () => {
    const child = row('c', { parent_session_id: 'p', session_key: 'k' })
    expect(
      isListableSession(
        child,
        row('p', { end_reason: 'idle', session_key: 'k' }),
      ),
    ).toBe(true)
    expect(
      isListableSession(
        child,
        row('p', { end_reason: 'idle', session_key: 'x' }),
      ),
    ).toBe(false)
  })

  it('a legacy branch child must start after its parent ended', () => {
    const parent = row('p', { end_reason: 'branched', ended_at: 50 })
    expect(
      isListableSession(row('c', { parent_session_id: 'p' }), parent),
    ).toBe(true)
    expect(
      isListableSession(
        row('c', { parent_session_id: 'p', started_at: 10 }),
        parent,
      ),
    ).toBe(false)
  })
})
