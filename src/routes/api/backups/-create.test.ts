import { afterEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  dashboardFetch: vi.fn(),
}))

const auth = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => true),
}))

const rateLimit = vi.hoisted(() => ({
  requireJsonContentType: vi.fn(() => null),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => ({ options: opts, ...(opts as object) }),
}))

vi.mock('@/server/auth-middleware', () => ({
  isAuthenticated: auth.isAuthenticated,
}))

vi.mock('@/server/rate-limit', () => ({
  requireJsonContentType: rateLimit.requireJsonContentType,
}))

vi.mock('@/server/gateway-capabilities', () => ({
  dashboardFetch: gateway.dashboardFetch,
}))

vi.mock('@/server/profiles-browser', () => ({
  getActiveProfileName: () => 'hermes-switch',
}))

async function getPostHandler() {
  const mod = await import('./create')
  return (mod.Route as unknown as { options: { server: { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } } } }).options.server.handlers.POST
}

describe('POST /api/backups/create', () => {
  afterEach(() => {
    vi.clearAllMocks()
    auth.isAuthenticated.mockReturnValue(true)
    rateLimit.requireJsonContentType.mockReturnValue(null)
  })

  it('returns 401 when unauthenticated', async () => {
    auth.isAuthenticated.mockReturnValue(false)

    const handler = await getPostHandler()
    const req = new Request('http://localhost/api/backups/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ output: '/path/to/backup.zip' }),
    })
    const res = await handler({ request: req })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'Unauthorized' })
  })

  it('returns 415 when content-type is not JSON', async () => {
    rateLimit.requireJsonContentType.mockReturnValue(
      new Response(
        JSON.stringify({ error: 'Content-Type must be application/json' }),
        { status: 415, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const handler = await getPostHandler()
    const req = new Request('http://localhost/api/backups/create', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'output=/path/to/backup.zip',
    })
    const res = await handler({ request: req })

    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body).toEqual({ error: 'Content-Type must be application/json' })
  })

  it('forwards {output} body to upstream /api/ops/backup', async () => {
    gateway.dashboardFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, pid: 12345, name: 'hermes-backup-20260709.zip', archive: '/path/to/backup.zip' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const handler = await getPostHandler()
    const req = new Request('http://localhost/api/backups/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ output: '/path/to/backup.zip' }),
    })
    const res = await handler({ request: req })

    expect(gateway.dashboardFetch).toHaveBeenCalledTimes(1)
    expect(gateway.dashboardFetch).toHaveBeenCalledWith('/api/ops/backup?profile=hermes-switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ output: '/path/to/backup.zip' }),
    })
    expect(res.status).toBe(200)
  })

  it('forwards upstream response back to client', async () => {
    const mockResponse = JSON.stringify({ ok: true, pid: 12345, name: 'hermes-backup.zip', archive: '/backups/hermes-backup.zip' })
    gateway.dashboardFetch.mockResolvedValue(
      new Response(mockResponse, { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const handler = await getPostHandler()
    const req = new Request('http://localhost/api/backups/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await handler({ request: req })

    const body = await res.json()
    expect(body).toEqual({ ok: true, pid: 12345, name: 'hermes-backup.zip', archive: '/backups/hermes-backup.zip' })
    expect(res.headers.get('content-type')).toBe('application/json')
  })

  it('forwards empty body when no output is provided', async () => {
    gateway.dashboardFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, pid: 67890, name: 'default-backup.zip', archive: '/default.zip' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const handler = await getPostHandler()
    const req = new Request('http://localhost/api/backups/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await handler({ request: req })

    expect(gateway.dashboardFetch).toHaveBeenCalledWith('/api/ops/backup?profile=hermes-switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
  })
})
