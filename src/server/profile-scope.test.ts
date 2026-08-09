import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * P1 contract tests for the `/p/<profile>/` multiplex prefix.
 *
 * Modules are reset between tests because profile-scope caches the probed
 * topology, and hermes-api resolves CLAUDE_API at import time.
 */

vi.mock('./gateway-capabilities', () => ({
  BEARER_TOKEN: 'test-token',
  CLAUDE_API: 'http://127.0.0.1:8642',
  CLAUDE_DASHBOARD_URL: 'http://127.0.0.1:9119',
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'unavailable',
  dashboardFetch: vi.fn(),
  ensureGatewayProbed: vi.fn(),
  getCapabilities: vi.fn(() => ({
    dashboard: { available: false },
    enhancedChat: true,
  })),
  probeGateway: vi.fn(),
}))

vi.mock('./claude-dashboard-api', () => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  forkSession: vi.fn(),
  getSession: vi.fn(),
  getSessionMessages: vi.fn(),
  listSessions: vi.fn(),
  searchSessions: vi.fn(),
  updateSession: vi.fn(),
}))

/** Fake dashboard /api/status payload driving getGatewayMode(). */
function statusResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const MULTIPLEX = {
  gateway_mode: 'multiplex',
  profiles: ['default', 'hermes-switch', 'neo'],
  gateways: [
    {
      profile: 'default',
      served_profiles: ['default', 'hermes-switch', 'neo'],
    },
  ],
}

const SINGLE = {
  gateway_mode: 'single',
  profiles: ['default', 'hermes-switch'],
  gateways: [{ profile: 'hermes-switch' }],
}

/** Route /api/status to `topology`; everything else returns `gatewayResponse`. */
function stubFetch(
  topology: Record<string, unknown>,
  gatewayResponse: () => Response = () => new Response('{}', { status: 200 }),
) {
  const calls: Array<string> = []
  const fetchMock = vi.fn((input: unknown) => {
    const url = String(input)
    calls.push(url)
    return Promise.resolve(
      url.includes('/api/status')
        ? statusResponse(topology)
        : gatewayResponse(),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('profilePath', () => {
  it('prefixes any explicit profile, with no special case for default', async () => {
    const { profilePath } = await import('./profile-scope')
    expect(profilePath('/api/sessions', 'default')).toBe(
      '/p/default/api/sessions',
    )
    expect(profilePath('/api/sessions', 'neo')).toBe('/p/neo/api/sessions')
  })

  it('encodes the profile segment and rejects relative paths', async () => {
    const { profilePath } = await import('./profile-scope')
    expect(profilePath('/v1/models', 'a b/c')).toBe('/p/a%20b%2Fc/v1/models')
    expect(() => profilePath('v1/models', 'neo')).toThrow(/must start with/)
  })
})

describe('scopedPath', () => {
  it('leaves an unscoped path untouched and never probes topology', async () => {
    const calls = stubFetch(SINGLE)
    const { scopedPath } = await import('./profile-scope')
    expect(await scopedPath('/api/sessions', null)).toBe('/api/sessions')
    expect(await scopedPath('/api/sessions', undefined)).toBe('/api/sessions')
    expect(await scopedPath('/api/sessions', '')).toBe('/api/sessions')
    expect(calls).toHaveLength(0)
  })

  it('prefixes `default` when it is explicitly selected', async () => {
    stubFetch(MULTIPLEX)
    const { scopedPath } = await import('./profile-scope')
    expect(await scopedPath('/api/sessions', 'default')).toBe(
      '/p/default/api/sessions',
    )
  })

  it("prefixes the gateway's own active profile — no omit-when-equal shortcut", async () => {
    // 'hermes-switch' is the live gateway's active profile (see SINGLE), yet
    // under multiplexing an unprefixed request would land on `default`.
    stubFetch(MULTIPLEX)
    const { scopedPath } = await import('./profile-scope')
    expect(await scopedPath('/api/sessions', 'hermes-switch')).toBe(
      '/p/hermes-switch/api/sessions',
    )
  })

  it('fails closed when the gateway is not multiplexed', async () => {
    stubFetch(SINGLE)
    const { scopedPath, ProfileScopeUnavailableError, profileErrorStatus } =
      await import('./profile-scope')
    const err = await scopedPath('/api/sessions', 'neo').catch((e) => e)
    expect(err).toBeInstanceOf(ProfileScopeUnavailableError)
    expect(err.profile).toBe('neo')
    expect(profileErrorStatus(err)).toBe(409)
  })

  it('fails closed when the probe itself fails (unreachable dashboard)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    )
    // Topology couldn't be established at all — distinct from "known to be
    // single, and this isn't the profile it runs" (ProfileScopeUnavailableError).
    const { scopedPath, ProfileScopeIndeterminateError } =
      await import('./profile-scope')
    const err = await scopedPath('/api/sessions', 'neo').catch((e) => e)
    expect(err).toBeInstanceOf(ProfileScopeIndeterminateError)
    expect(err.reason).toBe('probe-failed')
  })

  it('fails closed when multiplexing is on but the profile is not served', async () => {
    stubFetch(MULTIPLEX)
    const { scopedPath, ProfileNotServedError, profileErrorStatus } =
      await import('./profile-scope')
    const err = await scopedPath('/api/sessions', 'trinity').catch((e) => e)
    expect(err).toBeInstanceOf(ProfileNotServedError)
    expect(err.servedProfiles).toEqual(['default', 'hermes-switch', 'neo'])
    expect(profileErrorStatus(err)).toBe(404)
  })

  it('fails closed when multiplex is on but the served roster is unreadable', async () => {
    // `gateways[]` is gated off on a non-loopback dashboard bind. An empty
    // roster must refuse every profile, not wave them all through.
    stubFetch({ gateway_mode: 'multiplex', profiles: ['default', 'neo'] })
    const { scopedPath, ProfileNotServedError } =
      await import('./profile-scope')
    await expect(scopedPath('/api/sessions', 'neo')).rejects.toBeInstanceOf(
      ProfileNotServedError,
    )
  })
})

describe('assertProfileResponseOk', () => {
  it('surfaces 404 and 401 on a prefixed request as typed errors', async () => {
    const { assertProfileResponseOk, ProfileRequestFailedError } =
      await import('./profile-scope')
    for (const status of [404, 401, 403]) {
      const err = await assertProfileResponseOk(
        new Response('nope', { status }),
        'neo',
      ).catch((e) => e)
      expect(err).toBeInstanceOf(ProfileRequestFailedError)
      expect(err.status).toBe(status)
      expect(err.profile).toBe('neo')
    }
  })

  it('stays quiet for unscoped requests and for OK responses', async () => {
    const { assertProfileResponseOk } = await import('./profile-scope')
    await expect(
      assertProfileResponseOk(new Response('nope', { status: 404 }), null),
    ).resolves.toBeUndefined()
    await expect(
      assertProfileResponseOk(new Response('{}', { status: 200 }), 'neo'),
    ).resolves.toBeUndefined()
  })
})

describe('gateway transports', () => {
  it('sends the prefix on the wire for a scoped enhanced stream', async () => {
    const calls = stubFetch(
      MULTIPLEX,
      () =>
        new Response('event: done\ndata: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    const { streamChat } = await import('./hermes-api')
    await streamChat(
      'sess-1',
      { message: 'hi' },
      { profile: 'neo', onEvent: () => {} },
    )
    expect(calls).toContain(
      'http://127.0.0.1:8642/p/neo/api/sessions/sess-1/chat/stream',
    )
  })

  it('leaves the enhanced stream URL unprefixed when no profile is selected', async () => {
    const calls = stubFetch(
      MULTIPLEX,
      () => new Response('data: [DONE]\n\n', { status: 200 }),
    )
    const { streamChat } = await import('./hermes-api')
    await streamChat('sess-1', { message: 'hi' }, { onEvent: () => {} })
    expect(calls).toEqual([
      'http://127.0.0.1:8642/api/sessions/sess-1/chat/stream',
    ])
  })

  it('sends the prefix for the portable /v1/chat/completions transport', async () => {
    const calls = stubFetch(
      MULTIPLEX,
      () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: '' } }] }),
          {
            status: 200,
          },
        ),
    )
    const { openaiChat } = await import('./openai-compat-api')
    await openaiChat([{ role: 'user', content: 'hi' }], {
      model: 'gpt-x',
      profile: 'neo',
    })
    expect(calls).toContain('http://127.0.0.1:8642/p/neo/v1/chat/completions')
  })

  it('sends the prefix for the structured /v1/responses transport', async () => {
    const calls = stubFetch(
      MULTIPLEX,
      () =>
        new Response('data: {"type":"response.completed"}\n\n', {
          status: 200,
        }),
    )
    const { streamResponses } = await import('./responses-api')
    for await (const _ of streamResponses({ input: 'hi', profile: 'neo' })) {
      // drain
    }
    expect(calls).toContain('http://127.0.0.1:8642/p/neo/v1/responses')
  })

  it('refuses a scoped send before it reaches the wire when multiplex is off', async () => {
    const calls = stubFetch(SINGLE)
    const { streamChat } = await import('./hermes-api')
    const { ProfileScopeUnavailableError } = await import('./profile-scope')
    await expect(
      streamChat(
        'sess-1',
        { message: 'hi' },
        { profile: 'neo', onEvent: () => {} },
      ),
    ).rejects.toBeInstanceOf(ProfileScopeUnavailableError)
    // Only the topology probe went out; nothing hit the gateway.
    expect(calls.filter((u) => u.includes(':8642'))).toHaveLength(0)
  })

  it('surfaces a gateway 404 on a prefixed POST as a typed error', async () => {
    stubFetch(MULTIPLEX, () => new Response('no session', { status: 404 }))
    const { createSession } = await import('./hermes-api')
    const { ProfileRequestFailedError } = await import('./profile-scope')
    const err = await createSession(undefined, 'neo').catch((e) => e)
    expect(err).toBeInstanceOf(ProfileRequestFailedError)
    expect(err.status).toBe(404)
  })

  it('sends the identical Authorization header across profiles — no per-profile token plumbing', async () => {
    // APIServerAdapter captures its API key once at construction (§1.7): there
    // is exactly one listener key for the whole multiplexed gateway, not one
    // per profile. If a per-profile token ever crept in, this would diverge.
    const seen: Array<{ url: string; auth: string | null }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown, init?: RequestInit) => {
        const url = String(input)
        const headers = (init?.headers ?? {}) as Partial<
          Record<string, string>
        >
        seen.push({ url, auth: headers.Authorization ?? null })
        if (url.includes('/api/status'))
          return Promise.resolve(statusResponse(MULTIPLEX))
        return Promise.resolve(
          new Response('event: done\ndata: [DONE]\n\n', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
        )
      }),
    )
    const { streamChat } = await import('./hermes-api')
    await streamChat(
      'sess-1',
      { message: 'hi' },
      { profile: 'default', onEvent: () => {} },
    )
    await streamChat(
      'sess-1',
      { message: 'hi' },
      { profile: 'neo', onEvent: () => {} },
    )

    const gatewayCalls = seen.filter((s) => !s.url.includes('/api/status'))
    expect(gatewayCalls).toHaveLength(2)
    expect(gatewayCalls[0].auth).toBe('Bearer test-token')
    expect(gatewayCalls[1].auth).toBe('Bearer test-token')
  })
})

describe('cache downgrade mid-session (§1.3-C accepted window)', () => {
  it('serves a stale multiplex verdict for the cache TTL after a live downgrade, then fails closed', async () => {
    // No send-path caller ever passes {force: true} — only the manual
    // /api/gateway-reprobe endpoint does — so MODE_TTL_MS (5000ms) is the sole
    // real mitigation for a gateway that drops multiplexing mid-session. This
    // pins that window: a stale-multiplex read is accepted (and a scoped
    // write still resolves to a prefixed path) for up to 5000ms after the
    // real topology flips, and MUST fail closed once the TTL elapses. If a
    // future change widens the window (a longer TTL, a cache read that skips
    // the age check), this test catches it.
    vi.useFakeTimers()
    let live: Record<string, unknown> = MULTIPLEX
    const calls: Array<string> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) => {
        calls.push(String(input))
        return Promise.resolve(statusResponse(live))
      }),
    )
    const { scopedPath, ProfileScopeUnavailableError } =
      await import('./profile-scope')

    expect(await scopedPath('/api/sessions', 'neo')).toBe('/p/neo/api/sessions')
    expect(calls).toHaveLength(1)

    // The gateway restarts with multiplexing off. Nothing invalidates the
    // cache — this is the live topology change, not a client-side event.
    live = SINGLE

    // Still inside the TTL: the cached (now-wrong) multiplex verdict is
    // served, and a prefixed send still resolves. This IS the accepted
    // hazard window, not a bug — it's pinned here so it can't silently grow.
    vi.advanceTimersByTime(4_999)
    expect(await scopedPath('/api/sessions', 'neo')).toBe('/p/neo/api/sessions')
    expect(calls).toHaveLength(1) // no reprobe yet — served from cache

    // Past the TTL: the next call reprobes, observes the live downgrade, and
    // fails closed rather than silently prefixing into a single-profile db.
    vi.advanceTimersByTime(2)
    await expect(scopedPath('/api/sessions', 'neo')).rejects.toBeInstanceOf(
      ProfileScopeUnavailableError,
    )
    expect(calls).toHaveLength(2)

    vi.useRealTimers()
  })
})

describe('non-multiplexed gateway: its own profile is reachable unprefixed', () => {
  // Regression: the guard used to reject EVERY explicit profile whenever
  // multiplexing was off, including the profile the gateway was actually
  // running. That refused the single most common request in a normal install
  // ("show me the profile I'm already on") and made the scoped UI unusable.
  //
  // This is NOT the rejected rev-1 rule ("omit the prefix whenever profile ===
  // active"), which was unsafe because it also omitted under multiplex — where
  // a bare URL means `default`, not the active profile. The exemption below is
  // strictly limited to multiplex being OFF.

  it('serves the gateway\'s own profile UNPREFIXED instead of failing closed', async () => {
    const calls = stubFetch(SINGLE)
    const { scopedPath } = await import('./profile-scope')

    // SINGLE fixture runs `hermes-switch`. A bare path already resolves there,
    // and a prefix would be silently ignored upstream (200 proving nothing).
    await expect(scopedPath('/api/sessions', 'hermes-switch')).resolves.toBe(
      '/api/sessions',
    )
    expect(calls.some((u) => u.includes('/api/status'))).toBe(true)
  })

  it('still refuses a profile the gateway is not running', async () => {
    stubFetch(SINGLE)
    const { scopedPath, ProfileScopeUnavailableError } = await import(
      './profile-scope'
    )
    await expect(scopedPath('/api/sessions', 'neo')).rejects.toBeInstanceOf(
      ProfileScopeUnavailableError,
    )
  })

  it('names the reachable profile in the error, not just "enable multiplex"', async () => {
    stubFetch(SINGLE)
    const { scopedPath } = await import('./profile-scope')
    await expect(scopedPath('/api/sessions', 'neo')).rejects.toThrow(
      /running the "hermes-switch" profile/,
    )
  })

  it('fails closed when the probe cannot determine the active profile', async () => {
    // No `gateways[]` — topology unknown beyond "not multiplexed". Guessing
    // here would be the wrong-profile write this module exists to prevent.
    // This is a LOCAL dashboard (no `auth_required`), so the reason is
    // 'probe-failed' rather than 'remote-gated' — see the next describe block.
    stubFetch({ gateway_mode: 'single', profiles: ['hermes-switch'] })
    const { scopedPath, ProfileScopeIndeterminateError } = await import(
      './profile-scope'
    )
    const err = await scopedPath('/api/sessions', 'hermes-switch').catch((e) => e)
    expect(err).toBeInstanceOf(ProfileScopeIndeterminateError)
    expect(err.reason).toBe('probe-failed')
  })

  it('under multiplex, the multiplexer\'s own profile is STILL prefixed', async () => {
    // The exemption must not leak into multiplex mode: there, unprefixed
    // means `default`, so omitting would silently retarget the write.
    stubFetch(MULTIPLEX)
    const { scopedPath } = await import('./profile-scope')
    await expect(scopedPath('/api/sessions', 'default')).resolves.toBe(
      '/p/default/api/sessions',
    )
  })
})

describe('"multiple" gateway_mode is NOT multiplex (W3 audit item 2)', () => {
  // hermes_cli/web_server.py's `_collect_profile_gateway_topology` reports
  // "multiple" for several INDEPENDENT single-profile gateway processes —
  // never for one multiplexer. None of them understands `/p/<profile>/`, and
  // this payload has no port info tying any one entry to the specific
  // CLAUDE_API host this workspace actually talks to.
  const MULTIPLE = {
    gateway_mode: 'multiple',
    profiles: ['default', 'coder'],
    gateways: [{ profile: 'default', ports: {} }, { profile: 'coder', ports: {} }],
  }

  it('never resolves to multiplex — every explicit profile fails closed', async () => {
    stubFetch(MULTIPLE)
    const { scopedPath, ProfileScopeIndeterminateError } =
      await import('./profile-scope')
    const err = await scopedPath('/api/sessions', 'coder').catch((e) => e)
    expect(err).toBeInstanceOf(ProfileScopeIndeterminateError)
    expect(err.reason).toBe('probe-failed')
  })

  it('does not guess an active profile from the first entry', async () => {
    // Guessing "default" here (the first `gateways[]` entry) could attribute
    // CLAUDE_API's answers to the wrong one of the two live processes.
    stubFetch(MULTIPLE)
    const { scopedPath, ProfileScopeIndeterminateError } =
      await import('./profile-scope')
    await expect(
      scopedPath('/api/sessions', 'default'),
    ).rejects.toBeInstanceOf(ProfileScopeIndeterminateError)
  })
})

describe('remote/gated dashboard: topology unknown, not "not multiplexed" (W3 audit item 3)', () => {
  // hermes_cli/web_server.py gates `gateways[]` / `hermes_home` behind
  // `!auth_required` — a remote (non-loopback) client gets the public shape
  // only. `gateway_mode` and `auth_required` themselves survive the gate.
  it('fails closed to a distinct reason when the dashboard is gated — never blames multiplex config', async () => {
    stubFetch({ gateway_mode: 'single', profiles: ['default'], auth_required: true })
    const { scopedPath, ProfileScopeIndeterminateError } =
      await import('./profile-scope')
    const err = await scopedPath('/api/sessions', 'default').catch((e) => e)
    expect(err).toBeInstanceOf(ProfileScopeIndeterminateError)
    expect(err.reason).toBe('remote-gated')
    expect(err.message).not.toMatch(/enable gateway\.multiplex_profiles/i)
  })

  it('does not manufacture an empty served roster when multiplex is on but gated', async () => {
    // `gateway_mode: 'multiplex'` survives the gate; `gateways[]` (and thus
    // `served_profiles`) does not. An empty roster here must not read as
    // "confirmed not served" (404) — it's "cannot confirm from here".
    stubFetch({ gateway_mode: 'multiplex', profiles: ['default', 'neo'], auth_required: true })
    const { scopedPath, ProfileScopeIndeterminateError, ProfileNotServedError } =
      await import('./profile-scope')
    const err = await scopedPath('/api/sessions', 'neo').catch((e) => e)
    expect(err).toBeInstanceOf(ProfileScopeIndeterminateError)
    expect(err).not.toBeInstanceOf(ProfileNotServedError)
    expect(err.reason).toBe('remote-gated')
  })

  it('a local (non-gated) probe with an empty multiplex roster still 404s as "not served"', async () => {
    // Regression guard: the new remote-gated branch must not swallow the
    // pre-existing local behaviour for the same-shaped payload.
    stubFetch({ gateway_mode: 'multiplex', profiles: ['default', 'neo'] })
    const { scopedPath, ProfileNotServedError } = await import('./profile-scope')
    await expect(scopedPath('/api/sessions', 'neo')).rejects.toBeInstanceOf(
      ProfileNotServedError,
    )
  })
})
