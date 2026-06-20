import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isAuthenticated } = vi.hoisted(() => ({
  isAuthenticated: vi.fn(),
}))

const { getMnemosyneStats } = vi.hoisted(() => ({
  getMnemosyneStats: vi.fn(),
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated,
}))

vi.mock('../../server/mnemosyne-browser', () => ({
  getMnemosyneStats,
}))

async function loadRoute() {
  vi.resetModules()
  return import('./memory/stats')
}

describe('/api/memory/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    isAuthenticated.mockReturnValue(false)
    const mod = await loadRoute()
    const handler = (mod.Route as any).options.server.handlers.GET
    const response = await handler({
      request: new Request('http://localhost/api/memory/stats'),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns stats when the helper succeeds', async () => {
    isAuthenticated.mockReturnValue(true)
    getMnemosyneStats.mockReturnValue({
      checkedAt: 123,
      db: { exists: true },
      counts: { working: 1, episodic: 2, triples: 3, fts: 4, total: 3 },
    })

    const mod = await loadRoute()
    const handler = (mod.Route as any).options.server.handlers.GET
    const response = await handler({
      request: new Request('http://localhost/api/memory/stats'),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      checkedAt: 123,
      db: { exists: true },
      counts: { working: 1, episodic: 2, triples: 3, fts: 4, total: 3 },
    })
  })

  it('returns 200 with an explicit missing-db payload when the db is absent', async () => {
    isAuthenticated.mockReturnValue(true)
    getMnemosyneStats.mockReturnValue({
      checkedAt: 123,
      db: { exists: false },
      counts: { working: 0, episodic: 0, triples: 0, fts: 0, total: 0 },
      missingReason: "Mnemosyne database not found for bank 'default'",
    })

    const mod = await loadRoute()
    const handler = (mod.Route as any).options.server.handlers.GET
    const response = await handler({
      request: new Request('http://localhost/api/memory/stats'),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      checkedAt: 123,
      db: { exists: false },
      counts: { working: 0, episodic: 0, triples: 0, fts: 0, total: 0 },
      missingReason: "Mnemosyne database not found for bank 'default'",
    })
  })

  it('returns 500 on unexpected helper errors', async () => {
    isAuthenticated.mockReturnValue(true)
    getMnemosyneStats.mockImplementation(() => {
      throw new Error('boom')
    })

    const mod = await loadRoute()
    const handler = (mod.Route as any).options.server.handlers.GET
    const response = await handler({
      request: new Request('http://localhost/api/memory/stats'),
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'boom' })
  })
})
