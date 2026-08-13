import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `GET|POST /api/sessions/:sessionKey/yolo` — the per-session approval bypass.
 *
 * Drives the REAL handlers with only the gateway stubbed. Three things are
 * load-bearing and all three are asserted against the wire call, not against a
 * mock of our own mapping:
 *
 *  1. `X-Hermes-Session-Key`. The gateway keys the bypass on
 *     `gateway_session_key or session_id`. Verified live: enabling under
 *     `sk-test-1` and reading back without the header returns `false`. A
 *     mismatched key here would flip a set the approval guard never reads —
 *     the exact failure that made `/yolo` useless over `slash.exec`.
 *  2. A non-boolean `enabled` is rejected at OUR edge, before the gateway sees
 *     it. The gateway also coerces "on"/"1"/"yes"; we deliberately do not, so
 *     no typo can be coerced into ENABLING a bypass.
 *  3. A 404 from an unscoped request means the gateway build predates
 *     hermes-agent 0.19.13 — degrade, don't error.
 */

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts as object,
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

vi.mock('../../server/rate-limit', () => ({
  requireJsonContentType: () => null,
}))

const gateway = vi.hoisted(() => ({ fetch: vi.fn() }))
const caps = vi.hoisted(() => ({ sessions: true }))

vi.mock('../../server/gateway-capabilities', () => ({
  gatewayFetch: gateway.fetch,
}))

vi.mock('../../server/hermes-api', () => ({
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'unavailable',
  ensureGatewayProbed: vi.fn(() =>
    Promise.resolve({ sessions: caps.sessions }),
  ),
  getGatewayCapabilities: () => ({ sessions: caps.sessions }),
}))

vi.mock('../../server/profile-scope', () => ({
  assertProfileResponseOk: vi.fn(() => Promise.resolve(undefined)),
  assertProfileServed: vi.fn(() => Promise.resolve(undefined)),
  isProfileScopeError: () => false,
  profileErrorStatus: () => 502,
  readProfile: (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  scopedPath: vi.fn((path: string, profile: string | null) =>
    Promise.resolve(profile ? `/p/${profile}${path}` : path),
  ),
}))

function gatewayJson(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }
}

type Handler = (ctx: {
  request: Request
  params: { sessionKey: string }
}) => Promise<Response>

async function handlers() {
  return (await import('./sessions/$sessionKey.yolo')).Route as unknown as {
    server: { handlers: { GET: Handler; POST: Handler } }
  }
}

async function get(
  sessionKey = 'sess-1',
  query = '',
  headers: Record<string, string> = {},
) {
  const route = await handlers()
  return route.server.handlers.GET({
    request: new Request(
      `http://localhost/api/sessions/${sessionKey}/yolo${query}`,
      { headers },
    ),
    params: { sessionKey },
  })
}

async function post(
  body: Record<string, unknown>,
  sessionKey = 'sess-1',
  headers: Record<string, string> = { 'Content-Type': 'application/json' },
) {
  const route = await handlers()
  return route.server.handlers.POST({
    request: new Request(`http://localhost/api/sessions/${sessionKey}/yolo`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    params: { sessionKey },
  })
}

/** The `X-Hermes-Session-Key` actually put on the wire. */
function sentSessionKey(call = 0): string | undefined {
  const init = gateway.fetch.mock.calls[call]?.[1] as
    | { headers?: Record<string, string> }
    | undefined
  return init?.headers?.['X-Hermes-Session-Key']
}

function sentBody(call = 0): unknown {
  const init = gateway.fetch.mock.calls[call]?.[1] as
    | { body?: string }
    | undefined
  return init?.body ? JSON.parse(init.body) : undefined
}

beforeEach(() => {
  vi.resetModules()
  gateway.fetch.mockReset()
  caps.sessions = true
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/sessions/:sessionKey/yolo', () => {
  it('reports the gateway state and keys the read on the path session key', async () => {
    gateway.fetch.mockResolvedValue(
      gatewayJson(200, {
        object: 'hermes.session.yolo',
        session_id: 'sess-1',
        enabled: true,
      }),
    )
    const res = await get()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, enabled: true })
    expect(gateway.fetch.mock.calls[0][0]).toBe('/api/sessions/sess-1/yolo')
    expect(sentSessionKey()).toBe('sess-1')
  })

  it('prefers an inbound X-Hermes-Session-Key over the path id', async () => {
    // resolveSessionKeyValue's precedence, not an ad-hoc `||` — a caller that
    // holds a distinct stable key must be able to address the same set the
    // chat transport registers approvals under.
    gateway.fetch.mockResolvedValue(gatewayJson(200, { enabled: false }))
    await get('sess-1', '', { 'X-Hermes-Session-Key': 'sk-test-1' })

    expect(sentSessionKey()).toBe('sk-test-1')
  })

  it('falls back to the path id when the inbound header is blank', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(200, { enabled: false }))
    await get('sess-1', '', { 'X-Hermes-Session-Key': '   ' })

    expect(sentSessionKey()).toBe('sess-1')
  })

  it('treats a 404 as "this gateway build has no bypass", not an error', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(404, {}))
    const res = await get()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      enabled: false,
      unsupported: true,
    })
  })

  it('never reports enabled:true from a failed read', async () => {
    gateway.fetch.mockResolvedValue(
      gatewayJson(500, { error: { message: 'boom' } }),
    )
    const res = await get()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'boom' })
  })

  it('prefixes the path and honours ?profile=', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(200, { enabled: false }))
    await get('sess-1', '?profile=neo')

    expect(gateway.fetch.mock.calls[0][0]).toBe(
      '/p/neo/api/sessions/sess-1/yolo',
    )
  })

  it('503s when the gateway has no sessions API', async () => {
    caps.sessions = false
    const res = await get()

    expect(res.status).toBe(503)
    expect(gateway.fetch).not.toHaveBeenCalled()
  })
})

describe('POST /api/sessions/:sessionKey/yolo', () => {
  it('enables and echoes the state the gateway now holds', async () => {
    gateway.fetch.mockResolvedValue(
      gatewayJson(200, { enabled: true, previous: false }),
    )
    const res = await post({ enabled: true })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      enabled: true,
      previous: false,
    })
    expect(sentBody()).toEqual({ enabled: true })
    expect(sentSessionKey()).toBe('sess-1')
  })

  it('disables', async () => {
    gateway.fetch.mockResolvedValue(
      gatewayJson(200, { enabled: false, previous: true }),
    )
    const res = await post({ enabled: false })

    expect(await res.json()).toEqual({
      ok: true,
      enabled: false,
      previous: true,
    })
    expect(sentBody()).toEqual({ enabled: false })
  })

  it('forwards an omitted `enabled` as the gateway toggle', async () => {
    gateway.fetch.mockResolvedValue(
      gatewayJson(200, { enabled: true, previous: false }),
    )
    await post({})

    expect(sentBody()).toEqual({})
  })

  it.each([['maybe'], ['true'], [1], [{}]])(
    'rejects a non-boolean `enabled` (%s) without touching the gateway',
    async (value) => {
      const res = await post({ enabled: value })

      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(
        'enabled must be a boolean (omit it to toggle)',
      )
      // State unchanged means the gateway was never asked.
      expect(gateway.fetch).not.toHaveBeenCalled()
    },
  )

  it('trusts the gateway echo over the requested value', async () => {
    // The set the approval guard reads is the only authority. If the gateway
    // says the bypass is off, "I asked for on" is not evidence of anything.
    gateway.fetch.mockResolvedValue(
      gatewayJson(200, { enabled: false, previous: false }),
    )
    const res = await post({ enabled: true })

    expect(await res.json()).toMatchObject({ ok: true, enabled: false })
  })

  it('maps a 404 to a typed unsupported failure, never a silent success', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(404, {}))
    const res = await post({ enabled: true })

    expect(res.status).toBe(501)
    expect(await res.json()).toMatchObject({ ok: false, unsupported: true })
  })

  it('surfaces a gateway 400 verbatim', async () => {
    gateway.fetch.mockResolvedValue(
      gatewayJson(400, {
        error: {
          message: 'enabled must be a boolean (omit it to toggle)',
          code: 'invalid_enabled',
        },
      }),
    )
    const res = await post({ enabled: true })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(
      'enabled must be a boolean (omit it to toggle)',
    )
  })

  it('carries the profile into the path and prefixes the write', async () => {
    gateway.fetch.mockResolvedValue(
      gatewayJson(200, { enabled: true, previous: false }),
    )
    await post({ enabled: true, profile: 'neo' })

    expect(gateway.fetch.mock.calls[0][0]).toBe(
      '/p/neo/api/sessions/sess-1/yolo',
    )
    // `profile` is ours; it must not leak into the gateway body.
    expect(sentBody()).toEqual({ enabled: true })
  })

  it('400s on an unparseable body', async () => {
    const route = await handlers()
    const res = await route.server.handlers.POST({
      request: new Request('http://localhost/api/sessions/sess-1/yolo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }),
      params: { sessionKey: 'sess-1' },
    })

    expect(res.status).toBe(400)
    expect(gateway.fetch).not.toHaveBeenCalled()
  })

  it('503s when the gateway has no sessions API', async () => {
    caps.sessions = false
    const res = await post({ enabled: true })

    expect(res.status).toBe(503)
    expect(gateway.fetch).not.toHaveBeenCalled()
  })
})
