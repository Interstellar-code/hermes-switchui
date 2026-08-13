import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Rows 10 and 11 — `searchSessions` and `forkSession` were unscoped.
 *
 * These call the REAL hermes-api functions against a stubbed gateway and
 * assert on the URL that actually leaves the process, so a "threaded but never
 * emitted" profile parameter cannot pass. `forkSession` is the destructive
 * one: unprefixed, it forks whichever `state.db` the gateway happens to run on.
 */

const capabilities = { dashboard: { available: false }, enhancedChat: true }

vi.mock('./gateway-capabilities', () => ({
  BEARER_TOKEN: 'test-token',
  CLAUDE_API: 'http://127.0.0.1:8642',
  CLAUDE_DASHBOARD_URL: 'http://127.0.0.1:9119',
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'unavailable',
  dashboardFetch: vi.fn(),
  ensureGatewayProbed: vi.fn(),
  getCapabilities: vi.fn(() => capabilities),
  probeGateway: vi.fn(),
}))

const dashboardApi = vi.hoisted(() => ({
  forkSession: vi.fn(async () => ({
    session: { id: 'dash' },
    forked_from: 'x',
  })),
  searchSessions: vi.fn(async () => ({ results: [] })),
}))

vi.mock('./claude-dashboard-api', () => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  forkSession: dashboardApi.forkSession,
  getSession: vi.fn(),
  getSessionMessages: vi.fn(),
  listSessions: vi.fn(),
  searchSessions: dashboardApi.searchSessions,
  updateSession: vi.fn(),
}))

const MULTIPLEX = {
  gateway_mode: 'multiplex',
  gateways: [{ profile: 'default', served_profiles: ['default', 'neo'] }],
}
// The gateway runs a DIFFERENT profile than the one these tests request
// ('neo'), so 'neo' is genuinely unreachable and the fail-closed assertions
// below test what they claim to. Do not "simplify" this to `profile: 'neo'`:
// a non-multiplexed gateway serves its own profile unprefixed, so that would
// make these requests legitimately succeed and the tests would assert the
// opposite of the real contract.
const SINGLE = {
  gateway_mode: 'single',
  gateways: [{ profile: 'hermes-switch' }],
}

/** Bodies of every non-status request, parallel to `wire`. */
let wireBodies: Array<unknown>

/** Records every non-status URL that leaves the process. */
function stubFetch(topology: Record<string, unknown>) {
  const wire: Array<string> = []
  wireBodies = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/status')) {
        return Promise.resolve(
          new Response(JSON.stringify(topology), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }
      wire.push(url)
      wireBodies.push(init?.body)
      return Promise.resolve(
        new Response(JSON.stringify({ results: [], session: { id: 'f' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }),
  )
  return wire
}

beforeEach(() => {
  vi.resetModules()
  capabilities.dashboard.available = false
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('searchSessions scoping (row 10)', () => {
  it('prefixes the search with /p/<profile>/', async () => {
    const wire = stubFetch(MULTIPLEX)
    const { searchSessions } = await import('./hermes-api')

    await searchSessions('needle', 20, 'neo')

    expect(wire).toHaveLength(1)
    expect(wire[0]).toContain('/p/neo/api/sessions/search')
  })

  it('fails closed when the gateway is not multiplexing', async () => {
    const wire = stubFetch(SINGLE)
    const { searchSessions } = await import('./hermes-api')

    await expect(searchSessions('needle', 20, 'neo')).rejects.toThrow(
      /cannot be targeted/,
    )
    expect(wire).toHaveLength(0)
  })

  it('skips the unscoped dashboard shortcut for an explicit profile', async () => {
    capabilities.dashboard.available = true
    const wire = stubFetch(MULTIPLEX)
    const { searchSessions } = await import('./hermes-api')

    await searchSessions('needle', 20, 'neo')

    expect(dashboardApi.searchSessions).not.toHaveBeenCalled()
    expect(wire[0]).toContain('/p/neo/')
  })

  it('leaves the unscoped search byte-identical (dashboard shortcut, no prefix)', async () => {
    capabilities.dashboard.available = true
    const wire = stubFetch(MULTIPLEX)
    const { searchSessions } = await import('./hermes-api')

    await searchSessions('needle')

    expect(dashboardApi.searchSessions).toHaveBeenCalledWith('needle')
    expect(wire).toHaveLength(0)
  })
})

describe('forkSession scoping (row 11)', () => {
  it('prefixes the fork with /p/<profile>/ — the fork must land in that state.db', async () => {
    const wire = stubFetch(MULTIPLEX)
    const { forkSession } = await import('./hermes-api')

    await forkSession('abc123', 'neo')

    expect(wire).toHaveLength(1)
    expect(wire[0]).toBe('http://127.0.0.1:8642/p/neo/api/sessions/abc123/fork')
  })

  it('fails closed rather than forking into the active profile', async () => {
    const wire = stubFetch(SINGLE)
    const { forkSession } = await import('./hermes-api')

    await expect(forkSession('abc123', 'neo')).rejects.toThrow(
      /cannot be targeted/,
    )
    expect(wire).toHaveLength(0)
  })

  it('skips the unscoped dashboard shortcut for an explicit profile', async () => {
    capabilities.dashboard.available = true
    const wire = stubFetch(MULTIPLEX)
    const { forkSession } = await import('./hermes-api')

    await forkSession('abc123', 'neo')

    expect(dashboardApi.forkSession).not.toHaveBeenCalled()
    expect(wire[0]).toContain('/p/neo/')
  })

  it('sends a JSON body — the gateway 400s a bodyless fork', async () => {
    // `_handle_fork_session` calls `_read_json_body()` unconditionally and
    // answers a bodyless POST with 400 "Invalid JSON in request body".
    // claudePost() only serialises a truthy body, so passing `undefined`
    // (as this function originally did) made every real fork fail — invisible
    // to the URL-only assertions above.
    const wire = stubFetch(MULTIPLEX)
    const { forkSession } = await import('./hermes-api')

    await forkSession('abc123', 'neo')

    expect(wire).toHaveLength(1)
    expect(wireBodies[0]).toBe('{}')
  })

  it('leaves the unscoped fork byte-identical (dashboard shortcut, no prefix)', async () => {
    capabilities.dashboard.available = true
    const wire = stubFetch(MULTIPLEX)
    const { forkSession } = await import('./hermes-api')

    await forkSession('abc123')

    expect(dashboardApi.forkSession).toHaveBeenCalledWith('abc123')
    expect(wire).toHaveLength(0)
  })

  it('falls through to the gateway when the dashboard has no fork route', async () => {
    // The dashboard (:9119) never exposed POST /api/sessions/{id}/fork — its
    // session family is GET/PATCH/DELETE + /messages, /export,
    // /latest-descendant (hermes_cli/web_server.py). Without this fallthrough
    // the shortcut turns every unscoped branch into a hard 404.
    capabilities.dashboard.available = true
    dashboardApi.forkSession.mockRejectedValueOnce(
      new Error('Hermes Agent dashboard /api/sessions/abc123/fork: 404 '),
    )
    const wire = stubFetch(MULTIPLEX)
    const { forkSession } = await import('./hermes-api')

    const out = await forkSession('abc123')

    expect(dashboardApi.forkSession).toHaveBeenCalledWith('abc123')
    expect(wire).toHaveLength(1)
    expect(wire[0]).toBe('http://127.0.0.1:8642/api/sessions/abc123/fork')
    expect(out.session.id).toBe('f')
  })
})
