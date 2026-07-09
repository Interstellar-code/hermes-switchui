import { afterEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  dashboardFetch: vi.fn(),
  ensureGatewayProbed: vi.fn().mockResolvedValue({ sessions: false }),
}))

const auth = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => true),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => ({ options: opts, ...(opts as object) }),
}))

vi.mock('@/server/auth-middleware', () => ({
  isAuthenticated: auth.isAuthenticated,
}))

vi.mock('@/server/gateway-capabilities', () => ({
  dashboardFetch: gateway.dashboardFetch,
  ensureGatewayProbed: gateway.ensureGatewayProbed,
}))

async function getGetHandler() {
  const mod = await import('./list')
  return (mod.Route as unknown as { options: { server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } } } }).options.server.handlers.GET
}

describe('GET /api/backups/list', () => {
  afterEach(() => {
    vi.clearAllMocks()
    auth.isAuthenticated.mockReturnValue(true)
  })

  it('returns 401 when unauthenticated', async () => {
    auth.isAuthenticated.mockReturnValue(false)

    const handler = await getGetHandler()
    const req = new Request('http://localhost/api/backups/list', { method: 'GET' })
    const res = await handler({ request: req })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'Unauthorized' })
  })

  it('graceful 404: returns {ok: false, pending: true, backups: []} with status 200 when upstream returns 404', async () => {
    gateway.dashboardFetch.mockResolvedValue(new Response('Not Found', { status: 404 }))

    const handler = await getGetHandler()
    const req = new Request('http://localhost/api/backups/list', { method: 'GET' })
    const res = await handler({ request: req })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: false, pending: true, backups: [] })
  })

  it('forwards JSON when upstream returns 200 with backups', async () => {
    gateway.dashboardFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          backups: [
            { name: 'backup1.zip', archive: '/path/backup1.zip', size: 1024, mtime: 1234567890, mtime_iso: '2026-05-17T00:00:00Z' },
            { name: 'backup2.zip', archive: '/path/backup2.zip', size: 2048, mtime: 1234567900, mtime_iso: '2026-05-17T00:01:40Z' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const handler = await getGetHandler()
    const req = new Request('http://localhost/api/backups/list', { method: 'GET' })
    const res = await handler({ request: req })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.backups).toHaveLength(2)
    expect(body.backups[0].name).toBe('backup1.zip')
    expect(body.backups[1].name).toBe('backup2.zip')
  })

  it('graceful error: returns {ok: false, pending: true, backups: []} when upstream throws', async () => {
    gateway.dashboardFetch.mockRejectedValue(new Error('Network error'))

    const handler = await getGetHandler()
    const req = new Request('http://localhost/api/backups/list', { method: 'GET' })
    const res = await handler({ request: req })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: false, pending: true, backups: [] })
  })

  it('graceful error: returns {ok: false, pending: true, backups: []} when upstream returns non-200', async () => {
    gateway.dashboardFetch.mockResolvedValue(new Response('Internal Server Error', { status: 500 }))

    const handler = await getGetHandler()
    const req = new Request('http://localhost/api/backups/list', { method: 'GET' })
    const res = await handler({ request: req })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: false, pending: true, backups: [] })
  })

  it('calls ensureGatewayProbed before fetching', async () => {
    gateway.dashboardFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, backups: [] }), { status: 200 }),
    )

    const handler = await getGetHandler()
    const req = new Request('http://localhost/api/backups/list', { method: 'GET' })
    await handler({ request: req })

    expect(gateway.ensureGatewayProbed).toHaveBeenCalledTimes(1)
    expect(gateway.dashboardFetch).toHaveBeenCalledTimes(1)
  })
})