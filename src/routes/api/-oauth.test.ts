import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { rateLimit, rateLimitResponse, requireJsonContentType } from '../../server/rate-limit'
import { Route as DeviceCodeRoute } from './oauth.device-code'
import { Route as PollTokenRoute } from './oauth.poll-token'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => ({ options: opts }),
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/rate-limit', () => ({
  requireJsonContentType: vi.fn().mockReturnValue(null),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  rateLimit: vi.fn().mockReturnValue(true),
  rateLimitResponse: vi.fn().mockReturnValue(
    new Response(JSON.stringify({ error: 'Too many requests, please try again later' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
}))

// Stub the upstream fetch used inside the handlers
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Stub fs so saveNousTokens doesn't touch the real filesystem
vi.mock('node:fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockImplementation(() => {
      throw new Error('no file')
    }),
  },
}))

const deviceCodeHandlers = (DeviceCodeRoute as any).options.server.handlers
const pollTokenHandlers = (PollTokenRoute as any).options.server.handlers

const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockRateLimit = vi.mocked(rateLimit)
const mockRequireJsonContentType = vi.mocked(requireJsonContentType)
const mockRateLimitResponse = vi.mocked(rateLimitResponse)

function makeRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsAuthenticated.mockReturnValue(true)
  mockRateLimit.mockReturnValue(true)
  mockRequireJsonContentType.mockReturnValue(null)
  mockRateLimitResponse.mockReturnValue(
    new Response(JSON.stringify({ error: 'Too many requests, please try again later' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ device_code: 'dev123', user_code: 'USR-CODE', verification_uri: 'https://example.com/activate', expires_in: 900, interval: 5 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/oauth/device-code
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/oauth/device-code', () => {
  it('returns 401 when not authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const res = await deviceCodeHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/oauth/device-code', { provider: 'nous' }),
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 429 when rate limit exceeded', async () => {
    mockRateLimit.mockReturnValue(false)
    const res = await deviceCodeHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/oauth/device-code', { provider: 'nous' }),
    })
    expect(res.status).toBe(429)
  })

  it('returns 415 when CSRF check fails (non-JSON content-type)', async () => {
    mockRequireJsonContentType.mockReturnValue(
      new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
        status: 415,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const req = new Request('http://localhost/api/oauth/device-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'provider=nous',
    })
    const res = await deviceCodeHandlers.POST({ request: req })
    expect(res.status).toBe(415)
  })

  it('passes through to upstream for authenticated request with nous provider', async () => {
    const res = await deviceCodeHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/oauth/device-code', { provider: 'nous' }),
    })
    expect(mockIsAuthenticated).toHaveBeenCalled()
    expect(mockRateLimit).toHaveBeenCalledWith(expect.stringContaining('oauth-device-code:'), 10, 60_000)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.device_code).toBe('dev123')
  })

  it('returns 400 for unknown provider', async () => {
    const res = await deviceCodeHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/oauth/device-code', { provider: 'unknown' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not supported/)
  })

  it('returns 400 for missing provider field', async () => {
    const res = await deviceCodeHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/oauth/device-code', {}),
    })
    expect(res.status).toBe(400)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/oauth/poll-token
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/oauth/poll-token', () => {
  it('returns 401 when not authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const res = await pollTokenHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/oauth/poll-token', {
        provider: 'nous',
        deviceCode: 'dev123',
      }),
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 429 when rate limit exceeded', async () => {
    mockRateLimit.mockReturnValue(false)
    const res = await pollTokenHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/oauth/poll-token', {
        provider: 'nous',
        deviceCode: 'dev123',
      }),
    })
    expect(res.status).toBe(429)
  })

  it('returns 415 when CSRF check fails', async () => {
    mockRequireJsonContentType.mockReturnValue(
      new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
        status: 415,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const req = new Request('http://localhost/api/oauth/poll-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'provider=nous&deviceCode=dev123',
    })
    const res = await pollTokenHandlers.POST({ request: req })
    expect(res.status).toBe(415)
  })

  it('returns pending status while authorization is in progress', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'authorization_pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const res = await pollTokenHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/oauth/poll-token', {
        provider: 'nous',
        deviceCode: 'dev123',
      }),
    })
    expect(mockIsAuthenticated).toHaveBeenCalled()
    expect(mockRateLimit).toHaveBeenCalledWith(expect.stringContaining('oauth-poll-token:'), 20, 60_000)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('pending')
  })

  it('returns success and saves tokens for authenticated request', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'tok_abc', refresh_token: 'ref_xyz' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const res = await pollTokenHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/oauth/poll-token', {
        provider: 'nous',
        deviceCode: 'dev123',
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('success')
    expect(body.accessToken).toBe('tok_abc')
  })

  it('returns 400 for missing deviceCode field', async () => {
    const res = await pollTokenHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/oauth/poll-token', {
        provider: 'nous',
      }),
    })
    expect(res.status).toBe(400)
  })
})
