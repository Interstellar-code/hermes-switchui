import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Row 13 — `/api/sessions/send` never read `body.profile`, so a scoped send
 * was silently unscoped even though `sendChat` accepts a profile.
 *
 * This drives the REAL route handler with the REAL profile-scope module; only
 * the gateway (`fetch`) and the chat call are stubbed. A route that mocked
 * profile-scope could not tell "fails closed" from "never checked".
 */

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts as object,
}))

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

vi.mock('../../../server/rate-limit', () => ({
  requireJsonContentType: () => null,
}))

const hermes = vi.hoisted(() => ({
  sendChat: vi.fn(async () => ({ run_id: 'run-1' })),
}))

vi.mock('../../../server/hermes-api', () => ({
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'unavailable',
  ensureGatewayProbed: vi.fn(async () => ({
    enhancedChat: true,
    dashboard: { available: false },
  })),
  getGatewayCapabilities: vi.fn(),
  sendChat: hermes.sendChat,
}))

vi.mock('../../../server/session-utils', () => ({
  resolveSessionKey: vi.fn(async () => ({ sessionKey: 'sess-1' })),
}))

vi.mock('../../../server/gateway-capabilities', () => ({
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
// so `profile: 'neo'` here would make the send legitimately succeed and
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

async function postSend(body: Record<string, unknown>) {
  const route = (await import('./send')).Route as unknown as {
    server: {
      handlers: { POST: (ctx: { request: Request }) => Promise<Response> }
    }
  }
  return route.server.handlers.POST({
    request: new Request('http://localhost/api/sessions/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
}

beforeEach(() => {
  vi.resetModules()
  hermes.sendChat.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('/api/sessions/send profile scoping (row 13)', () => {
  it('forwards an explicit profile to sendChat', async () => {
    stubStatus(MULTIPLEX)
    const res = await postSend({ message: 'hi', profile: 'neo' })

    expect(res.status).toBe(200)
    expect(hermes.sendChat).toHaveBeenCalledWith(
      'sess-1',
      { message: 'hi' },
      undefined,
      { profile: 'neo' },
    )
  })

  it('fails closed with 409 and sends nothing when the gateway is not multiplexing', async () => {
    stubStatus(SINGLE)
    const res = await postSend({ message: 'hi', profile: 'neo' })

    expect(res.status).toBe(409)
    expect(hermes.sendChat).not.toHaveBeenCalled()
  })

  it('fails closed with 404 for a profile this gateway does not serve', async () => {
    stubStatus(MULTIPLEX)
    const res = await postSend({ message: 'hi', profile: 'nope' })

    expect(res.status).toBe(404)
    expect(hermes.sendChat).not.toHaveBeenCalled()
  })

  it('leaves an unscoped send unchanged and never probes topology', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await postSend({ message: 'hi' })

    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(hermes.sendChat).toHaveBeenCalledWith(
      'sess-1',
      { message: 'hi' },
      undefined,
      { profile: null },
    )
  })
})
