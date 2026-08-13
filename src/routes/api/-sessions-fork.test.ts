import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/sessions/:sessionKey/fork — the `/branch` route.
 *
 * A fork is two writes at once: it ends the source session
 * (`end_reason: "branched"`) and creates a child carrying its transcript. So
 * the profile guard has to fail closed BEFORE the gateway is touched, exactly
 * like sessions.ts POST/PATCH/DELETE — a `/p/` prefix on a non-multiplexing
 * gateway returns 200 while branching whatever shares that ID in the active
 * profile's state.db.
 *
 * Uses the REAL profile-scope module so "fails closed" is distinguishable from
 * "never checked".
 */

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts as object,
}))

vi.mock('../../server/auth-middleware', () => ({ isAuthenticated: () => true }))
vi.mock('../../server/rate-limit', () => ({
  requireJsonContentType: () => null,
}))

const hermes = vi.hoisted(() => ({
  forkSession: vi.fn(async () => ({
    session: { id: 'fork-id', parent_session_id: 'src-key' },
  })),
  ensureGatewayProbed: vi.fn(async () => ({ sessions: true })),
}))

const local = vi.hoisted(() => ({ getLocalSession: vi.fn(() => undefined) }))

vi.mock('../../server/hermes-api', () => ({
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'unavailable',
  ensureGatewayProbed: hermes.ensureGatewayProbed,
  forkSession: hermes.forkSession,
  toSessionSummary: (s: { id: string }) => ({ key: s.id, id: s.id }),
}))

vi.mock('../../server/local-session-store', () => ({
  getLocalSession: local.getLocalSession,
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

async function post(sessionKey: string, body: Record<string, unknown> = {}) {
  const route = (await import('./sessions/$sessionKey.fork'))
    .Route as unknown as {
    server: {
      handlers: {
        POST: (ctx: {
          request: Request
          params: { sessionKey: string }
        }) => Promise<Response>
      }
    }
  }
  return route.server.handlers.POST({
    request: new Request('http://localhost/api/sessions/x/fork', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params: { sessionKey },
  })
}

beforeEach(() => {
  vi.resetModules()
  hermes.forkSession.mockClear()
  hermes.forkSession.mockResolvedValue({
    session: { id: 'fork-id', parent_session_id: 'src-key' },
  })
  hermes.ensureGatewayProbed.mockClear()
  hermes.ensureGatewayProbed.mockResolvedValue({ sessions: true })
  local.getLocalSession.mockReturnValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/sessions/:sessionKey/fork', () => {
  it('forks the session key as given and reports the new key', async () => {
    stubStatus(MULTIPLEX)
    const res = await post('src-key')
    const body = await res.json()

    expect(res.status).toBe(200)
    // The key goes to the gateway untouched — no getSession() "resolution"
    // hop, which would route through the unscoped dashboard and 404 for
    // gateway-owned rows it does not carry.
    // readProfile() yields null (not undefined) for an unscoped request.
    expect(hermes.forkSession).toHaveBeenCalledWith('src-key', null)
    expect(body).toMatchObject({
      ok: true,
      sessionKey: 'fork-id',
      forkedFrom: 'src-key',
    })
  })

  it('threads an explicit profile into the fork', async () => {
    stubStatus(MULTIPLEX)
    const res = await post('src-key', { profile: 'neo' })

    expect(res.status).toBe(200)
    expect(hermes.forkSession).toHaveBeenCalledWith('src-key', 'neo')
  })

  it('fails closed when the gateway is not multiplexing', async () => {
    stubStatus(SINGLE)
    const res = await post('src-key', { profile: 'neo' })

    expect(res.status).toBe(409)
    // Nothing must reach the gateway — the source would be ended in the
    // WRONG profile's state.db, which no later request can undo.
    expect(hermes.forkSession).not.toHaveBeenCalled()
  })

  it('rejects local sessions instead of forking a gateway row that is not theirs', async () => {
    stubStatus(MULTIPLEX)
    local.getLocalSession.mockReturnValue({ id: 'local-1' } as never)
    const res = await post('local-1')

    expect(res.status).toBe(400)
    expect(hermes.forkSession).not.toHaveBeenCalled()
  })

  it('503s when the gateway has no sessions API', async () => {
    stubStatus(MULTIPLEX)
    hermes.ensureGatewayProbed.mockResolvedValue({ sessions: false })
    const res = await post('src-key')

    expect(res.status).toBe(503)
    expect(hermes.forkSession).not.toHaveBeenCalled()
  })

  it('maps a gateway 404 to a 404 rather than a 500', async () => {
    stubStatus(MULTIPLEX)
    hermes.forkSession.mockRejectedValue(
      new Error('Hermes Agent API POST /api/sessions/gone/fork: 404 not found'),
    )
    const res = await post('gone')

    expect(res.status).toBe(404)
  })

  it('rejects a blank session key', async () => {
    stubStatus(MULTIPLEX)
    const res = await post('   ')

    expect(res.status).toBe(400)
    expect(hermes.forkSession).not.toHaveBeenCalled()
  })
})
