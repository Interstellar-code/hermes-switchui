import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Row 28, route leg — repointing the gateway/dashboard must drop the cached
 * multiplex topology immediately, not wait out the 5s TTL. `gateway-reprobe`
 * already did this; `connection-settings` did not, so for that window a scoped
 * write was authorised by the OLD gateway's mode and sent to the NEW one.
 */

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts as object,
}))

vi.mock('../../server/auth-middleware', () => ({ isAuthenticated: () => true }))
vi.mock('../../server/rate-limit', () => ({
  requireJsonContentType: () => null,
}))

const caps = vi.hoisted(() => ({
  ensureGatewayProbed: vi.fn(async () => ({})),
  getResolvedUrls: vi.fn(() => ({ gateway: '', dashboard: '' })),
  setDashboardUrl: vi.fn(),
  setGatewayUrl: vi.fn(),
}))

vi.mock('../../server/gateway-capabilities', () => caps)

const scope = vi.hoisted(() => ({ invalidateGatewayMode: vi.fn() }))
vi.mock('../../server/profile-scope', () => scope)

async function put(body: Record<string, unknown>) {
  const route = (await import('./connection-settings')).Route as unknown as {
    server: {
      handlers: { PUT: (ctx: { request: Request }) => Promise<Response> }
    }
  }
  return route.server.handlers.PUT({
    request: new Request('http://localhost/api/connection-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
}

beforeEach(() => {
  vi.resetModules()
  scope.invalidateGatewayMode.mockClear()
  caps.setGatewayUrl.mockClear()
  caps.setDashboardUrl.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PUT /api/connection-settings (row 28)', () => {
  it('invalidates the cached topology when the gateway url changes', async () => {
    const res = await put({ gateway: 'http://example.test:8642' })

    expect(res.status).toBe(200)
    expect(caps.setGatewayUrl).toHaveBeenCalled()
    expect(scope.invalidateGatewayMode).toHaveBeenCalled()
  })

  it('invalidates the cached topology when the dashboard url changes', async () => {
    const res = await put({ dashboard: 'http://example.test:9119' })

    expect(res.status).toBe(200)
    expect(caps.setDashboardUrl).toHaveBeenCalled()
    expect(scope.invalidateGatewayMode).toHaveBeenCalled()
  })

  it('invalidates before the reprobe, so the reprobe cannot re-cache stale mode', async () => {
    const order: Array<string> = []
    scope.invalidateGatewayMode.mockImplementation(() =>
      order.push('invalidate'),
    )
    caps.ensureGatewayProbed.mockImplementation(async () => {
      order.push('reprobe')
      return {}
    })

    await put({ gateway: 'http://example.test:8642' })

    expect(order).toEqual(['invalidate', 'reprobe'])
  })

  it('does not invalidate when a rejected url never repoints anything', async () => {
    const res = await put({ gateway: 'not-a-url' })

    expect(res.status).toBe(400)
    expect(scope.invalidateGatewayMode).not.toHaveBeenCalled()
  })
})
