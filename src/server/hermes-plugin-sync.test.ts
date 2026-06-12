/**
 * Tests for hermes-plugin-sync.ts
 *
 * Covers:
 * - Allowlist stripping (secret-ish keys never forwarded)
 * - Snapshot mapping for 404 vs timeout vs healthy
 * - Register-once semantics (concurrent calls share in-flight promise)
 * - Heartbeat gated on successful register
 * - 413/422 → {ok:false} from forwardSettings
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock dashboardFetch ───────────────────────────────────────────────────────

vi.mock('./gateway-capabilities', () => ({
  dashboardFetch: vi.fn(),
}))

import { dashboardFetch } from './gateway-capabilities'
const mockFetch = vi.mocked(dashboardFetch)

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonOk(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: 'error' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function notFoundResponse(): Response {
  return errorResponse(404)
}

function timeoutError(): Promise<Response> {
  const err = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
  return Promise.reject(err)
}

// ── State reset between tests ─────────────────────────────────────────────────

// We reset the globalThis singleton between tests by deleting the symbol key
// so each test starts with a clean state.
const SYNC_STATE_KEY = Symbol.for('hermes.pluginSync')

beforeEach(() => {
  vi.clearAllMocks()
  // Reset singleton state.
  delete (globalThis as Record<symbol, unknown>)[SYNC_STATE_KEY]
})

afterEach(() => {
  // Clean up any timers started during the test.
  delete (globalThis as Record<symbol, unknown>)[SYNC_STATE_KEY]
})

// ── Import module under test (after mocks are set up) ────────────────────────

// We import after vi.mock so the mock is in place.
import {
  ensureHermesPluginSync,
  forwardSettings,
  getPluginSnapshot,
} from './hermes-plugin-sync'

// ── Allowlist stripping ───────────────────────────────────────────────────────

describe('forwardSettings — allowlist stripping', () => {
  it('forwards only allowlisted keys', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ ok: true }))

    const result = await forwardSettings({
      theme: 'matrix',
      locale: 'en',
      HERMES_PASSWORD: 'secret',
      apiKey: 'should-be-stripped',
      token: 'also-stripped',
      showTimestamps: true,
    })

    expect(result).toEqual({ ok: true })

    // Inspect what was sent to the backend.
    expect(mockFetch).toHaveBeenCalledOnce()
    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init?.body as string) as Record<string, unknown>

    expect(body).toHaveProperty('theme', 'matrix')
    expect(body).toHaveProperty('locale', 'en')
    expect(body).toHaveProperty('showTimestamps', true)
    expect(body).not.toHaveProperty('HERMES_PASSWORD')
    expect(body).not.toHaveProperty('apiKey')
    expect(body).not.toHaveProperty('token')
  })

  it('sends empty object when all keys are non-allowlisted', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ ok: true }))

    const result = await forwardSettings({
      secret: 'x',
      password: 'y',
      internalToken: 'z',
    })

    expect(result).toEqual({ ok: true })
    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect(Object.keys(body)).toHaveLength(0)
  })

  it('returns {ok:false} on 413 payload-too-large', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(413))
    const result = await forwardSettings({ theme: 'dark' })
    expect(result).toEqual({ ok: false })
  })

  it('returns {ok:false} on 422 validation error', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(422))
    const result = await forwardSettings({ theme: 'dark' })
    expect(result).toEqual({ ok: false })
  })

  it('returns {ok:false} on network error / timeout', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'))
    const result = await forwardSettings({ theme: 'dark' })
    expect(result).toEqual({ ok: false })
  })
})

// ── Snapshot: 404 → pluginAvailable:false ─────────────────────────────────────

describe('getPluginSnapshot — 404 (plugin not mounted)', () => {
  it('returns pluginAvailable:false, backendReachable:true when /register returns 404', async () => {
    // Registration attempt → 404
    mockFetch.mockResolvedValueOnce(notFoundResponse())

    const snapshot = await getPluginSnapshot()

    expect(snapshot.pluginAvailable).toBe(false)
    expect(snapshot.backendReachable).toBe(true)
    expect(snapshot.status).toBeNull()
    expect(snapshot.connection).toBeNull()
  })

  it('returns pluginAvailable:false when /status returns 404 even if /connection ok', async () => {
    // /register ok
    mockFetch.mockResolvedValueOnce(
      jsonOk({ ok: true, compat: { compatible: true, warn: null, plugin_range: null, frontend_version: '2.4.0' } }),
    )
    // /status → 404; /connection → ok
    mockFetch.mockResolvedValueOnce(notFoundResponse())
    mockFetch.mockResolvedValueOnce(
      jsonOk({
        gateway_port: 8642,
        dashboard_port: 9119,
        frontend_port: 3000,
        active_profile: 'default',
        enabled_plugins: ['hermes-switch-ui'],
        auth_mode: 'token',
      }),
    )

    const snapshot = await getPluginSnapshot()

    expect(snapshot.pluginAvailable).toBe(false)
    expect(snapshot.backendReachable).toBe(true)
  })
})

// ── Snapshot: timeout → backendReachable:false ────────────────────────────────

describe('getPluginSnapshot — timeout / network error', () => {
  it('returns backendReachable:false when /register times out', async () => {
    // /register → timeout
    mockFetch.mockRejectedValueOnce(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
    // /status and /connection also timeout (transient backend unreachable)
    mockFetch.mockRejectedValueOnce(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
    mockFetch.mockRejectedValueOnce(Object.assign(new Error('AbortError'), { name: 'AbortError' }))

    const snapshot = await getPluginSnapshot()

    // backendReachable:false because backend is unreachable.
    expect(snapshot.backendReachable).toBe(false)
  })

  it('returns backendReachable:false when /status times out after successful register', async () => {
    // /register ok
    mockFetch.mockResolvedValueOnce(
      jsonOk({ ok: true, compat: { compatible: true, warn: null, plugin_range: null, frontend_version: '2.4.0' } }),
    )
    // /status → timeout; /connection → timeout
    mockFetch.mockRejectedValueOnce(new Error('AbortError'))
    mockFetch.mockRejectedValueOnce(new Error('AbortError'))

    const snapshot = await getPluginSnapshot()

    expect(snapshot.backendReachable).toBe(false)
    expect(snapshot.status).toBeNull()
    expect(snapshot.connection).toBeNull()
  })
})

// ── Snapshot: healthy ─────────────────────────────────────────────────────────

describe('getPluginSnapshot — healthy', () => {
  it('returns full snapshot when all calls succeed', async () => {
    // /register
    mockFetch.mockResolvedValueOnce(
      jsonOk({
        ok: true,
        compat: {
          compatible: true,
          warn: null,
          plugin_range: '>=2.0.0',
          frontend_version: '2.4.0',
        },
      }),
    )
    // /status
    mockFetch.mockResolvedValueOnce(
      jsonOk({
        running: true,
        last_heartbeat: '2026-06-12T06:00:00Z',
        ttl_seconds: 90,
        manifest: { name: 'hermes-switch-ui' },
        reported_settings: { theme: 'matrix' },
      }),
    )
    // /connection
    mockFetch.mockResolvedValueOnce(
      jsonOk({
        gateway_port: 8642,
        dashboard_port: 9119,
        frontend_port: 3000,
        active_profile: 'default',
        enabled_plugins: ['hermes-switch-ui', 'karpathy-self-improve'],
        auth_mode: 'token',
      }),
    )

    const snapshot = await getPluginSnapshot()

    expect(snapshot.pluginAvailable).toBe(true)
    expect(snapshot.backendReachable).toBe(true)
    expect(snapshot.status).toMatchObject({
      running: true,
      last_heartbeat: '2026-06-12T06:00:00Z',
      ttl_seconds: 90,
    })
    expect(snapshot.connection).toMatchObject({
      gateway_port: 8642,
      dashboard_port: 9119,
      frontend_port: 3000,
      active_profile: 'default',
      enabled_plugins: expect.arrayContaining(['hermes-switch-ui']),
      auth_mode: 'token',
    })
    expect(snapshot.compat).toMatchObject({
      compatible: true,
      plugin_range: '>=2.0.0',
    })
    expect(snapshot.registeredAt).toBeTypeOf('string')
  })

  it('compat is null when registration has not yet succeeded', async () => {
    // Registration fails transiently.
    mockFetch.mockRejectedValueOnce(new Error('transient'))
    // /status and /connection also fail (backend unreachable).
    mockFetch.mockRejectedValueOnce(new Error('transient'))
    mockFetch.mockRejectedValueOnce(new Error('transient'))

    const snapshot = await getPluginSnapshot()

    // compat should be null — UNKNOWN state.
    expect(snapshot.compat).toBeNull()
  })
})

// ── Register-once semantics ───────────────────────────────────────────────────

describe('register-once semantics', () => {
  it('concurrent getPluginSnapshot calls share a single in-flight register promise', async () => {
    // /register → ok (called once)
    // /status × 2 and /connection × 2 for the two concurrent snapshots.
    mockFetch
      .mockResolvedValueOnce(jsonOk({ ok: true, compat: { compatible: true, warn: null, plugin_range: null, frontend_version: null } }))
      .mockResolvedValueOnce(jsonOk({ running: true, last_heartbeat: null, ttl_seconds: 90, manifest: null, reported_settings: null }))
      .mockResolvedValueOnce(jsonOk({ gateway_port: null, dashboard_port: null, frontend_port: null, active_profile: null, enabled_plugins: [], auth_mode: null }))
      .mockResolvedValueOnce(jsonOk({ running: true, last_heartbeat: null, ttl_seconds: 90, manifest: null, reported_settings: null }))
      .mockResolvedValueOnce(jsonOk({ gateway_port: null, dashboard_port: null, frontend_port: null, active_profile: null, enabled_plugins: [], auth_mode: null }))

    // Fire two concurrent snapshot requests.
    const [s1, s2] = await Promise.all([getPluginSnapshot(), getPluginSnapshot()])

    expect(s1.pluginAvailable).toBe(true)
    expect(s2.pluginAvailable).toBe(true)

    // /register should only have been called once.
    const registerCalls = mockFetch.mock.calls.filter(([path]) =>
      (path as string).includes('/register'),
    )
    expect(registerCalls).toHaveLength(1)
  })
})

// ── Heartbeat gated on register ───────────────────────────────────────────────

describe('ensureHermesPluginSync — heartbeat gated on register', () => {
  it('does not start heartbeat when registration fails', async () => {
    // /register → 404 → confirmed-absent
    mockFetch.mockResolvedValueOnce(notFoundResponse())

    ensureHermesPluginSync()
    // Wait a tick for the async register to complete.
    await new Promise((r) => setTimeout(r, 10))

    const state = (globalThis as Record<symbol, { heartbeatTimer: unknown }>)[SYNC_STATE_KEY]
    // No heartbeat timer should have been started.
    expect(state?.heartbeatTimer).toBeUndefined()
  })

  it('is idempotent — calling twice does not double-start', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonOk({ ok: true, compat: { compatible: true, warn: null, plugin_range: null, frontend_version: null } }))

    ensureHermesPluginSync()
    ensureHermesPluginSync()

    await new Promise((r) => setTimeout(r, 10))

    // /register called once.
    const registerCalls = mockFetch.mock.calls.filter(([path]) =>
      (path as string).includes('/register'),
    )
    expect(registerCalls).toHaveLength(1)
  })
})
