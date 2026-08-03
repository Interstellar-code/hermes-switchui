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

/** Records every non-status URL that leaves the process. */
function stubFetch(topology: Record<string, unknown>) {
  const wire: Array<string> = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
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

  it('leaves the unscoped fork byte-identical (dashboard shortcut, no prefix)', async () => {
    capabilities.dashboard.available = true
    const wire = stubFetch(MULTIPLEX)
    const { forkSession } = await import('./hermes-api')

    await forkSession('abc123')

    expect(dashboardApi.forkSession).toHaveBeenCalledWith('abc123')
    expect(wire).toHaveLength(0)
  })
})
