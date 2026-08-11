import { describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../../server/auth-middleware'
import { dashboardFetch } from '../../../server/gateway-capabilities'

const { Route } = await import('./$')

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../../server/gateway-capabilities', () => ({
  dashboardFetch: vi.fn(),
  BEARER_TOKEN: 'test-token',
}))

const { mockInvalidateConfigCache } = vi.hoisted(() => ({
  mockInvalidateConfigCache: vi.fn(),
}))

vi.mock('../../../server/hermes-api', () => ({
  invalidateConfigCache: mockInvalidateConfigCache,
}))

const handlers = (Route as any).options.server.handlers

const base = 'http://localhost/api/dashboard-proxy'

function makeJsonRequest(method: string, splat = '') {
  return new Request(`${base}${splat}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : '{}',
  })
}

function makeFormRequest(method: string, splat = '') {
  return new Request(`${base}${splat}`, {
    method,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'foo=bar',
  })
}

const invoke = async (method: string, request: Request, splat?: string) => {
  const fn = handlers[method]
  if (typeof fn !== 'function') throw new Error(`No handler for ${method}`)
  const response = await fn({
    request,
    params: { _splat: splat || '' },
  } as any)
  return response as Response
}

describe('dashboard-proxy CSRF guard', () => {
  it('returns 415 for POST with non-JSON content type', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)

    const res = await invoke(
      'POST',
      makeFormRequest('POST', '/restart'),
      '/restart',
    )

    expect(res.status).toBe(415)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/content-type must be application\/json/i),
    })
  })

  it('returns 415 for PUT with non-JSON content type', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    const res = await invoke(
      'PUT',
      makeFormRequest('PUT', '/config'),
      '/config',
    )
    expect(res.status).toBe(415)
  })

  it('returns 415 for PATCH with non-JSON content type', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    const res = await invoke(
      'PATCH',
      makeFormRequest('PATCH', '/env/FOO'),
      '/env/FOO',
    )
    expect(res.status).toBe(415)
  })

  it('returns 415 for DELETE with non-JSON content type', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    const res = await invoke(
      'DELETE',
      makeFormRequest('DELETE', '/tokens/123'),
      '/tokens/123',
    )
    expect(res.status).toBe(415)
  })

  it('passes through to proxy for authenticated POST with application/json', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(dashboardFetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await invoke(
      'POST',
      makeJsonRequest('POST', '/restart'),
      '/restart',
    )

    expect(res.status).toBe(200)
    expect(dashboardFetch).toHaveBeenCalled()
  })

  it('forwards an authenticated JSON DELETE to the dashboard', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(dashboardFetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await invoke(
      'DELETE',
      makeJsonRequest('DELETE', '/api/dashboard/agent-plugins/example'),
      '/api/dashboard/agent-plugins/example',
    )

    expect(res.status).toBe(200)
    expect(dashboardFetch).toHaveBeenCalledWith(
      '/api/dashboard/agent-plugins/example',
      expect.objectContaining({
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
  })

  it('GET skip CSRF and require auth', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)

    const getRes = await invoke('GET', new Request(`${base}/status`), '/status')
    expect(getRes.status).toBe(401)
  })

  /**
   * `getConfigCached()` in server/hermes-api.ts backs every session-status
   * poll with a 30s TTL. Settings writes go through this proxy and never
   * through that module, so a successful save used to leave the rest of the
   * app reading the pre-save config for up to half a minute.
   */
  describe('config cache invalidation', () => {
    function okJson() {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    it('invalidates the server config cache after a successful config write', async () => {
      mockInvalidateConfigCache.mockClear()
      vi.mocked(isAuthenticated).mockReturnValue(true)
      vi.mocked(dashboardFetch).mockResolvedValue(okJson())

      await invoke('PUT', makeJsonRequest('PUT', '/api/config'), '/api/config')

      expect(mockInvalidateConfigCache).toHaveBeenCalledTimes(1)
    })

    it('invalidates for a nested config path too', async () => {
      mockInvalidateConfigCache.mockClear()
      vi.mocked(isAuthenticated).mockReturnValue(true)
      vi.mocked(dashboardFetch).mockResolvedValue(okJson())

      await invoke(
        'PUT',
        makeJsonRequest('PUT', '/api/config/raw'),
        '/api/config/raw',
      )

      expect(mockInvalidateConfigCache).toHaveBeenCalledTimes(1)
    })

    it('does not invalidate on a read', async () => {
      mockInvalidateConfigCache.mockClear()
      vi.mocked(isAuthenticated).mockReturnValue(true)
      vi.mocked(dashboardFetch).mockResolvedValue(okJson())

      await invoke('GET', new Request(`${base}/api/config`), '/api/config')

      expect(mockInvalidateConfigCache).not.toHaveBeenCalled()
    })

    it('does not invalidate when the gateway rejects the write', async () => {
      mockInvalidateConfigCache.mockClear()
      vi.mocked(isAuthenticated).mockReturnValue(true)
      vi.mocked(dashboardFetch).mockResolvedValue(
        new Response('Method Not Allowed', { status: 405 }),
      )

      await invoke('PUT', makeJsonRequest('PUT', '/api/config'), '/api/config')

      expect(mockInvalidateConfigCache).not.toHaveBeenCalled()
    })

    it('does not invalidate for an unrelated write', async () => {
      mockInvalidateConfigCache.mockClear()
      vi.mocked(isAuthenticated).mockReturnValue(true)
      vi.mocked(dashboardFetch).mockResolvedValue(okJson())

      await invoke('POST', makeJsonRequest('POST', '/restart'), '/restart')

      expect(mockInvalidateConfigCache).not.toHaveBeenCalled()
    })
  })

  it('still requires auth after CSRF passes', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)

    const res = await invoke(
      'POST',
      makeJsonRequest('POST', '/restart'),
      '/restart',
    )

    expect(res.status).toBe(401)
  })
})
