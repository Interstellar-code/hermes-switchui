import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── fs mock ──────────────────────────────────────────────────────────────────
const { existsSync, readdirSync, statSync } = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({
    isDirectory: () => true,
    mtime: new Date(0),
    size: 0,
  }),
}))

vi.mock('node:fs', () => ({
  default: { existsSync, readdirSync, statSync },
  existsSync,
  readdirSync,
  statSync,
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

function makeRequest(): Request {
  return new Request('http://localhost/api/profiles/trash-list', { method: 'GET' })
}

async function getHandler() {
  vi.resetModules()
  const mod = await import('../trash-list')
  return (
    mod as unknown as {
      Route: {
        server: {
          handlers: { GET: (ctx: { request: Request }) => Response | Promise<Response> }
        }
      }
    }
  ).Route.server.handlers.GET
}

describe('GET /api/profiles/trash-list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existsSync.mockReturnValue(false)
    readdirSync.mockReturnValue([])
  })

  it('returns an empty trashed array when nothing is in trash', async () => {
    const handler = await getHandler()
    const res = await handler({ request: makeRequest() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { trashed: Array<unknown> }
    expect(body.trashed).toEqual([])
  })

  it('returns parsed trashed entries', async () => {
    const deletedAt = Date.now()
    existsSync.mockImplementation((p: string) => typeof p === 'string' && p.endsWith('/trash'))
    readdirSync.mockImplementation((p: string) => {
      // Only the trash root itself has children in this test; recursing into
      // a trashed entry for size computation should stop immediately.
      if (typeof p === 'string' && p.endsWith('/trash')) {
        return [
          { name: `jarvis-${deletedAt}`, isDirectory: () => true, isSymbolicLink: () => false },
        ]
      }
      return []
    })
    statSync.mockReturnValue({ isDirectory: () => true, mtime: new Date(0), size: 10 })

    const handler = await getHandler()
    const res = await handler({ request: makeRequest() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      trashed: Array<{ id: string; originalName: string; deletedAt: string }>
    }
    expect(body.trashed).toHaveLength(1)
    expect(body.trashed[0].originalName).toBe('jarvis')
    expect(body.trashed[0].id).toBe(`jarvis-${deletedAt}`)
  })
})
