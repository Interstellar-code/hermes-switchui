import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts as object,
}))
vi.mock('../../server/auth-middleware', () => ({ isAuthenticated: () => true }))

const mocks = vi.hoisted(() => ({
  dashboard: { available: true },
  listProfileSessions: vi.fn(),
  listSessions: vi.fn(),
}))

vi.mock('../../server/hermes-api', () => ({
  ensureGatewayProbed: vi.fn(async () => ({ dashboard: mocks.dashboard })),
}))
vi.mock('../../server/claude-dashboard-api', () => ({
  listProfileSessions: mocks.listProfileSessions,
  listSessions: mocks.listSessions,
}))

import { Route } from './sessions/source-totals'

type Handler = (ctx: { request: Request }) => Promise<Response>
const GET = (Route as unknown as { server: { handlers: { GET: Handler } } })
  .server.handlers.GET

const TOTALS: Record<string, number> = { cli: 265, recovered: 278 }

beforeEach(() => {
  mocks.dashboard.available = true
  const total = async (_p: unknown, _l: number, _o: number, f?: { source?: string }) => ({
    sessions: [],
    total: f?.source ? (TOTALS[f.source] ?? 0) : 853,
  })
  mocks.listProfileSessions.mockReset().mockImplementation(total)
  mocks.listSessions
    .mockReset()
    .mockImplementation((l: number, o: number, f?: { source?: string }) =>
      total(null, l, o, f),
    )
})

describe('GET /api/sessions/source-totals', () => {
  it('fans out one limit=1 count per source for the profile', async () => {
    const res = await GET({
      request: new Request('http://x/api/sessions/source-totals?profile=work'),
    })
    const body = await res.json()
    expect(body.totals.total).toBe(853)
    expect(body.totals.bySource).toMatchObject({
      cli: 265,
      recovered: 278,
      telegram: 0,
      cron: 0,
    })
    expect(mocks.listProfileSessions).toHaveBeenCalledWith('work', 1, 0, {
      source: 'cli',
    })
    expect(mocks.listSessions).not.toHaveBeenCalled()
  })

  it('reads the active profile unscoped without ?profile', async () => {
    const res = await GET({
      request: new Request('http://x/api/sessions/source-totals'),
    })
    expect((await res.json()).totals.bySource.cli).toBe(265)
    expect(mocks.listProfileSessions).not.toHaveBeenCalled()
  })

  it('rejects an invalid profile name with 400', async () => {
    const res = await GET({
      request: new Request(
        'http://x/api/sessions/source-totals?profile=../etc',
      ),
    })
    expect(res.status).toBe(400)
    expect(mocks.listProfileSessions).not.toHaveBeenCalled()
  })

  it('answers totals:null for a degraded profile', async () => {
    mocks.listProfileSessions.mockResolvedValue({
      sessions: [],
      total: 0,
      errors: [{ profile: 'work', error: 'schema drift' }],
    })
    const res = await GET({
      request: new Request('http://x/api/sessions/source-totals?profile=work'),
    })
    expect(await res.json()).toEqual({ ok: true, totals: null })
  })

  it('answers totals:null without the dashboard', async () => {
    mocks.dashboard.available = false
    const res = await GET({
      request: new Request('http://x/api/sessions/source-totals'),
    })
    expect(await res.json()).toEqual({ ok: true, totals: null })
  })
})
