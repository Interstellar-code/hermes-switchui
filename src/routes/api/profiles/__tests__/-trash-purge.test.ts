import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── fs mock ──────────────────────────────────────────────────────────────────
const { existsSync, rmSync } = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(false),
  rmSync: vi.fn().mockImplementation(() => {}),
}))

vi.mock('node:fs', () => ({
  default: { existsSync, rmSync },
  existsSync,
  rmSync,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))

vi.mock('@tanstack/react-start', () => ({
  json: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
      ...(init ?? {}),
      headers: {
        'Content-Type': 'application/json',
        ...((init as ResponseInit & { headers?: Record<string, string> })
          .headers ?? {}),
      },
    }),
}))

vi.mock('../../../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

vi.mock('../../../../server/rate-limit', () => ({
  requireJsonContentType: () => null,
}))

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/profiles/trash-purge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function getHandler() {
  vi.resetModules()
  const mod = await import('../trash-purge')
  return (
    mod as unknown as {
      Route: {
        server: {
          handlers: { POST: (ctx: { request: Request }) => Promise<Response> }
        }
      }
    }
  ).Route.server.handlers.POST
}

describe('POST /api/profiles/trash-purge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('permanently removes the entry and returns ok', async () => {
    const id = `jarvis-${Date.now()}`
    existsSync.mockImplementation(
      (p: string) => typeof p === 'string' && p.endsWith(`/trash/${id}`),
    )
    const handler = await getHandler()
    const res = await handler({ request: makeRequest({ id }) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body).toEqual({ ok: true })
    expect(rmSync).toHaveBeenCalledWith(
      expect.stringContaining(id),
      expect.objectContaining({ recursive: true, force: true }),
    )
  })

  it('returns 404 for an unknown id', async () => {
    existsSync.mockReturnValue(false)
    const handler = await getHandler()
    const res = await handler({ request: makeRequest({ id: 'no-such-id-1234567890' }) })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Trashed profile not found')
  })

  it.each(['../../etc', 'a/b', 'a\\b'])(
    'returns 400 for a path-unsafe id %j',
    async (badId) => {
      const handler = await getHandler()
      const res = await handler({ request: makeRequest({ id: badId }) })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('Invalid trash id')
    },
  )
})
