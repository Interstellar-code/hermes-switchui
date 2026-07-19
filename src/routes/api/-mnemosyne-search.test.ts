import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isAuthenticated } = vi.hoisted(() => ({ isAuthenticated: vi.fn() }))
const { searchMnemosyne } = vi.hoisted(() => ({ searchMnemosyne: vi.fn() }))

vi.mock('../../server/auth-middleware', () => ({ isAuthenticated }))
vi.mock('../../server/mnemosyne-browser', () => ({ searchMnemosyne }))

async function loadRoute() {
  vi.resetModules()
  return import('./memory/mnemosyne-search')
}

async function getHandler() {
  const mod = await loadRoute()
  return (mod.Route as any).options.server.handlers.GET as (ctx: {
    request: Request
  }) => Promise<Response>
}

describe('/api/memory/mnemosyne-search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isAuthenticated.mockReturnValue(true)
    searchMnemosyne.mockReturnValue([])
  })

  it('returns 401 when unauthenticated', async () => {
    isAuthenticated.mockReturnValue(false)
    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/memory/mnemosyne-search'),
    })
    expect(res.status).toBe(401)
    expect(searchMnemosyne).not.toHaveBeenCalled()
  })

  it('returns 200 with results + Cache-Control on success', async () => {
    searchMnemosyne.mockReturnValue([{ kind: 'gist', text: 'x', score: 2 }])
    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/memory/mnemosyne-search'),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ results: [{ kind: 'gist', text: 'x', score: 2 }] })
  })

  it('passes q + limit through to searchMnemosyne', async () => {
    const handler = await getHandler()
    await handler({
      request: new Request('http://localhost/api/memory/mnemosyne-search?q=thailand&limit=5'),
    })
    expect(searchMnemosyne).toHaveBeenCalledWith('thailand', 5)
  })

  it('clamps an over-max limit to 25', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/memory/mnemosyne-search?limit=999'),
    })
    expect(res.status).toBe(200)
    expect(searchMnemosyne).toHaveBeenCalledWith('', 25)
  })

  it('400s on non-integer / non-positive limit', async () => {
    const handler = await getHandler()
    for (const q of ['limit=abc', 'limit=0', 'limit=-1']) {
      const res = await handler({
        request: new Request(`http://localhost/api/memory/mnemosyne-search?${q}`),
      })
      expect(res.status, q).toBe(400)
      expect(await res.json()).toEqual({ error: 'limit must be a positive integer' })
    }
    expect(searchMnemosyne).not.toHaveBeenCalled()
  })

  it('returns 500 when searchMnemosyne throws', async () => {
    searchMnemosyne.mockImplementation(() => {
      throw new Error('boom')
    })
    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/memory/mnemosyne-search'),
    })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})
