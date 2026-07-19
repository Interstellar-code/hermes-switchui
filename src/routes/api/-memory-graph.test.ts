import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isAuthenticated } = vi.hoisted(() => ({ isAuthenticated: vi.fn() }))
const { buildMemoryGraph } = vi.hoisted(() => ({ buildMemoryGraph: vi.fn() }))

vi.mock('../../server/auth-middleware', () => ({ isAuthenticated }))
vi.mock('../../server/memory-graph', () => ({
  buildMemoryGraph,
  MAX_LIMIT: 5000,
}))

async function loadRoute() {
  vi.resetModules()
  return import('./memory/graph')
}

async function getHandler() {
  const mod = await loadRoute()
  return (mod.Route as any).options.server.handlers.GET as (ctx: {
    request: Request
  }) => Promise<Response>
}

const EMPTY = {
  nodes: [],
  edges: [],
  meta: {
    rawEdgeCount: 0,
    edgeCount: 0,
    nodeCount: 0,
    truncated: false,
    dbMissing: false,
    generatedAt: '2026-01-01T00:00:00.000Z',
  },
}

describe('/api/memory/graph', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isAuthenticated.mockReturnValue(true)
    buildMemoryGraph.mockReturnValue(EMPTY)
  })

  it('returns 401 when unauthenticated', async () => {
    isAuthenticated.mockReturnValue(false)
    const handler = await getHandler()
    const res = await handler({ request: new Request('http://localhost/api/memory/graph') })
    expect(res.status).toBe(401)
    expect(buildMemoryGraph).not.toHaveBeenCalled()
  })

  it('returns 200 with graph + Cache-Control on success', async () => {
    const handler = await getHandler()
    const res = await handler({ request: new Request('http://localhost/api/memory/graph') })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res.json()).toEqual(EMPTY)
  })

  it('400s on non-integer / non-positive limit', async () => {
    const handler = await getHandler()
    for (const q of ['limit=abc', 'limit=0', 'limit=-5', 'limit=1.5']) {
      const res = await handler({
        request: new Request(`http://localhost/api/memory/graph?${q}`),
      })
      expect(res.status, q).toBe(400)
    }
    expect(buildMemoryGraph).not.toHaveBeenCalled()
  })

  it('clamps an over-max limit instead of rejecting', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/memory/graph?limit=99999'),
    })
    expect(res.status).toBe(200)
    expect(buildMemoryGraph).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5000 }),
    )
  })

  it('400s on an unknown edgeType', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/memory/graph?edgeType=bogus'),
    })
    expect(res.status).toBe(400)
  })

  it('accepts allowlisted edgeType', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/memory/graph?edgeType=references'),
    })
    expect(res.status).toBe(200)
    expect(buildMemoryGraph).toHaveBeenCalledWith(
      expect.objectContaining({ edgeType: 'references' }),
    )
  })

  it('400s on an unparseable since', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/memory/graph?since=not-a-date'),
    })
    expect(res.status).toBe(400)
  })

  it('accepts a valid ISO since', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: new Request(
        'http://localhost/api/memory/graph?since=2026-01-01T00:00:00Z',
      ),
    })
    expect(res.status).toBe(200)
  })

  it('returns 500 when the builder throws', async () => {
    buildMemoryGraph.mockImplementation(() => {
      throw new Error('boom')
    })
    const handler = await getHandler()
    const res = await handler({ request: new Request('http://localhost/api/memory/graph') })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})
