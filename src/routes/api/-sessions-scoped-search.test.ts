import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Row 10, route leg — `/api/sessions?q=` with an explicit `?profile=`.
 *
 * Uses the REAL profile-scope module so "fails closed" is distinguishable from
 * "never checked", and asserts the profile reaches BOTH the search call and the
 * getSession() hydration of its hits (IDs are not unique across profiles).
 */

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts as object,
}))

vi.mock('../../server/auth-middleware', () => ({ isAuthenticated: () => true }))
vi.mock('../../server/rate-limit', () => ({
  requireJsonContentType: () => null,
}))

const hermes = vi.hoisted(() => ({
  searchSessions: vi.fn(async () => ({
    results: [{ session_id: 'sess-1', snippet: 'hit' }],
  })),
  getSession: vi.fn(async () => ({ id: 'sess-1' })),
  listSessions: vi.fn(async () => []),
}))

vi.mock('../../server/hermes-api', () => ({
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'unavailable',
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  ensureGatewayProbed: vi.fn(async () => ({
    sessions: true,
    enhancedChat: true,
    dashboard: { available: false },
  })),
  getSession: hermes.getSession,
  listSessions: hermes.listSessions,
  searchSessions: hermes.searchSessions,
  toSessionSummary: (s: { id: string }) => ({ key: s.id, id: s.id }),
  updateSession: vi.fn(),
}))

vi.mock('../../server/claude-dashboard-api', () => ({
  listProfileSessions: vi.fn(async () => ({ sessions: [], total: 0 })),
}))

vi.mock('../../server/local-session-store', () => ({
  deleteLocalSession: vi.fn(),
  getLocalSession: vi.fn(),
  listLocalSessions: vi.fn(() => []),
  updateLocalSessionTitle: vi.fn(),
}))

vi.mock('@/lib/feature-gates', () => ({
  createCapabilityUnavailablePayload: vi.fn(() => ({ ok: false })),
}))

vi.mock('../../server/gateway-capabilities', () => ({
  BEARER_TOKEN: '',
  CLAUDE_API: 'http://127.0.0.1:8642',
  CLAUDE_DASHBOARD_URL: 'http://127.0.0.1:9119',
}))

const MULTIPLEX = {
  gateway_mode: 'multiplex',
  gateways: [{ profile: 'default', served_profiles: ['default', 'neo'] }],
}
// Runs a DIFFERENT profile than the requested 'neo', so 'neo' really is
// unreachable. A non-multiplexed gateway serves its OWN profile unprefixed,
// so `profile: 'neo'` here would make the request legitimately succeed and
// invert what this fixture is for.
const SINGLE = {
  gateway_mode: 'single',
  gateways: [{ profile: 'hermes-switch' }],
}

function stubStatus(topology: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(topology), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  )
}

async function get(search: string) {
  const route = (await import('./sessions')).Route as unknown as {
    server: {
      handlers: { GET: (ctx: { request: Request }) => Promise<Response> }
    }
  }
  return route.server.handlers.GET({
    request: new Request(`http://localhost/api/sessions?${search}`),
  })
}

beforeEach(() => {
  vi.resetModules()
  hermes.searchSessions.mockClear()
  hermes.getSession.mockClear()
  hermes.listSessions.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/sessions scoped search (row 10)', () => {
  it('threads the profile into the search AND the hit hydration', async () => {
    stubStatus(MULTIPLEX)
    const res = await get('q=needle&profile=neo')

    expect(res.status).toBe(200)
    expect(hermes.searchSessions).toHaveBeenCalledWith('needle', 20, 'neo')
    expect(hermes.getSession).toHaveBeenCalledWith('sess-1', 'neo')
  })

  it('fails closed with 409 when the gateway is not multiplexing', async () => {
    stubStatus(SINGLE)
    const res = await get('q=needle&profile=neo')

    expect(res.status).toBe(409)
    expect(hermes.searchSessions).not.toHaveBeenCalled()
  })

  it('answers a scoped search with a search, not the unfiltered profile listing', async () => {
    stubStatus(MULTIPLEX)
    await get('q=needle&profile=neo')

    // Before the reorder, `?profile=` short-circuited into the browse branch
    // and dropped `q` — a search silently became a full listing.
    expect(hermes.searchSessions).toHaveBeenCalledTimes(1)
  })

  it('leaves the unscoped search path unchanged', async () => {
    stubStatus(MULTIPLEX)
    const res = await get('q=needle')

    expect(res.status).toBe(200)
    expect(hermes.searchSessions).toHaveBeenCalledWith('needle', 20, undefined)
    expect(hermes.getSession).toHaveBeenCalledWith('sess-1', undefined)
  })
})
