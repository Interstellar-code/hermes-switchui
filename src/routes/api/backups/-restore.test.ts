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

async function getPostHandler() {
  const mod = await import('./restore')
  return (mod.Route as unknown as { options: { server: { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } } } }).options.server.handlers.POST
}

describe('POST /api/backups/restore', () => {
  afterEach(() => {
    vi.clearAllMocks()
    auth.isAuthenticated.mockReturnValue(true)
    rateLimit.requireJsonContentType.mockReturnValue(null)
  })

  it('returns 401 when unauthenticated', async () => {
    auth.isAuthenticated.mockReturnValue(false)

    const handler = await getPostHandler()
    const req = new Request('http://localhost/api/backups/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archive: '/path/to/backup.zip' }),
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
    const req = new Request('http://localhost/api/backups/restore', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'archive=/path/to/backup.zip',
    })
    const res = await handler({ request: req })

    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body).toEqual({ error: 'Content-Type must be application/json' })
  })

  it('injects force: true server-side when client sends only archive', async () => {
    gateway.dashboardFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, pid: 54321, archive: '/path/to/backup.zip' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const handler = await getPostHandler()
    const req = new Request('http://localhost/api/backups/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archive: '/path/to/backup.zip' }),
    })
    const res = await handler({ request: req })

    expect(gateway.dashboardFetch).toHaveBeenCalledTimes(1)
    expect(gateway.dashboardFetch).toHaveBeenCalledWith('/api/ops/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archive: '/path/to/backup.zip', force: true }),
    })
    expect(res.status).toBe(200)
  })

  it('injects force: true server-side even when client sends force: false', async () => {
    gateway.dashboardFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, pid: 54321, archive: '/path/to/backup.zip' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const handler = await getPostHandler()
    const req = new Request('http://localhost/api/backups/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archive: '/path/to/backup.zip', force: false }),
    })
    const res = await handler({ request: req })

    expect(gateway.dashboardFetch).toHaveBeenCalledTimes(1)
    expect(gateway.dashboardFetch).toHaveBeenCalledWith('/api/ops/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archive: '/path/to/backup.zip', force: true }),
    })
    expect(res.status).toBe(200)
  })

  it('injects force: true server-side when client sends force: true (idempotent)', async () => {
    gateway.dashboardFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, pid: 54321, archive: '/path/to/backup.zip' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const handler = await getPostHandler()
    const req = new Request('http://localhost/api/backups/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archive: '/path/to/backup.zip', force: true }),
    })
    const res = await handler({ request: req })

    expect(gateway.dashboardFetch).toHaveBeenCalledTimes(1)
    expect(gateway.dashboardFetch).toHaveBeenCalledWith('/api/ops/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archive: '/path/to/backup.zip', force: true }),
    })
    expect(res.status).toBe(200)
  })

  it('forwards upstream response back to client', async () => {
    const mockResponse = JSON.stringify({ ok: true, pid: 99999, archive: '/restored/backup.zip', message: 'Restore started' })
    gateway.dashboardFetch.mockResolvedValue(
      new Response(mockResponse, { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const handler = await getPostHandler()
    const req = new Request('http://localhost/api/backups/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archive: '/path/to/backup.zip' }),
    })
    const res = await handler({ request: req })

    const body = await res.json()
    expect(body).toEqual({ ok: true, pid: 99999, archive: '/restored/backup.zip', message: 'Restore started' })
    expect(res.headers.get('content-type')).toBe('application/json')
  })

  it('forwards upstream error response back to client', async () => {
    const mockResponse = JSON.stringify({ ok: false, error: 'Backup file not found' })
    gateway.dashboardFetch.mockResolvedValue(
      new Response(mockResponse, { status: 404, headers: { 'content-type': 'application/json' } }),
    )

    const handler = await getPostHandler()
    const req = new Request('http://localhost/api/backups/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archive: '/path/to/backup.zip' }),
    })
    const res = await handler({ request: req })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'Backup file not found' })
  })
})