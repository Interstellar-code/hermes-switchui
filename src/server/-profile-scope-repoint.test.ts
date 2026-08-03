import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Row 28 — repointing the gateway must not reuse the previous gateway's
 * probed multiplex topology.
 *
 * The cache is keyed by the URLs it describes rather than invalidated by a
 * callback, so this exercises the key itself: flip a URL, the cached answer
 * must not be served. Getters keep the mocked module bindings live, the way
 * `export let CLAUDE_API` behaves in the real module.
 */

const urls = {
  api: 'http://127.0.0.1:8642',
  dashboard: 'http://127.0.0.1:9119',
}

vi.mock('./gateway-capabilities', () => ({
  BEARER_TOKEN: 'test-token',
  get CLAUDE_API() {
    return urls.api
  },
  get CLAUDE_DASHBOARD_URL() {
    return urls.dashboard
  },
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'unavailable',
  dashboardFetch: vi.fn(),
  ensureGatewayProbed: vi.fn(),
  getCapabilities: vi.fn(() => ({
    dashboard: { available: false },
    enhancedChat: true,
  })),
  probeGateway: vi.fn(),
}))

const MULTIPLEX = {
  gateway_mode: 'multiplex',
  gateways: [{ profile: 'default', served_profiles: ['default', 'neo'] }],
}

/** Counts /api/status probes so cache reuse is observable. */
function stubStatusFetch(body: Record<string, unknown> = MULTIPLEX) {
  const probes: Array<string> = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      probes.push(String(input))
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }),
  )
  return probes
}

beforeEach(() => {
  vi.resetModules()
  urls.api = 'http://127.0.0.1:8642'
  urls.dashboard = 'http://127.0.0.1:9119'
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getGatewayMode cache key', () => {
  it('reuses the cached topology while both URLs are unchanged', async () => {
    const probes = stubStatusFetch()
    const { getGatewayMode } = await import('./profile-scope')

    await getGatewayMode()
    await getGatewayMode()

    expect(probes).toHaveLength(1)
  })

  it('re-probes after the GATEWAY url is repointed, inside the TTL', async () => {
    const probes = stubStatusFetch()
    const { getGatewayMode } = await import('./profile-scope')

    await getGatewayMode()
    // setGatewayUrl() / the 8642->8643 port autodetect. The dashboard is
    // untouched, so a dashboard-only cache key would serve the old answer and
    // authorise a scoped write against a gateway that never reported it.
    urls.api = 'http://127.0.0.1:8643'
    await getGatewayMode()

    expect(probes).toHaveLength(2)
  })

  it('re-probes after the DASHBOARD url is repointed, inside the TTL', async () => {
    const probes = stubStatusFetch()
    const { getGatewayMode } = await import('./profile-scope')

    await getGatewayMode()
    urls.dashboard = 'http://127.0.0.1:9120'
    await getGatewayMode()

    expect(probes).toHaveLength(2)
    expect(probes[1]).toContain('9120')
  })

  it('does not hand an in-flight probe started before a repoint to a caller asking after it', async () => {
    const probes: Array<string> = []
    // Holder object, not a `let` — TS narrows a `let` assigned inside a
    // callback back to `null` at the call site below.
    const gate: { release: (() => void) | null } = { release: null }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) => {
        probes.push(String(input))
        return new Promise<Response>((resolve) => {
          const finish = () =>
            resolve(
              new Response(JSON.stringify(MULTIPLEX), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            )
          if (gate.release) finish()
          else gate.release = finish
        })
      }),
    )
    const { getGatewayMode } = await import('./profile-scope')

    const first = getGatewayMode()
    urls.api = 'http://127.0.0.1:8643'
    const second = getGatewayMode()
    gate.release?.()
    await Promise.all([first, second])

    expect(probes).toHaveLength(2)
  })

  it('invalidateGatewayMode() forces the next call to probe again', async () => {
    const probes = stubStatusFetch()
    const { getGatewayMode, invalidateGatewayMode } =
      await import('./profile-scope')

    await getGatewayMode()
    invalidateGatewayMode()
    await getGatewayMode()

    expect(probes).toHaveLength(2)
  })
})
