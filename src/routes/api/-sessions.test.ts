import { afterEach, describe, expect, it, vi } from 'vitest'

const hermes = vi.hoisted(() => ({
  ensureGatewayProbed: vi.fn(),
  listSessions: vi.fn(),
  toSessionSummary: vi.fn(),
}))

const localStore = vi.hoisted(() => ({
  listLocalSessions: vi.fn(),
  getLocalSession: vi.fn(),
  updateLocalSessionTitle: vi.fn(),
  deleteLocalSession: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => ({ options: opts, ...(opts as object) }),
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

vi.mock('../../server/hermes-api', () => ({
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'unavailable',
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  ensureGatewayProbed: hermes.ensureGatewayProbed,
  getGatewayCapabilities: vi.fn(),
  listSessions: hermes.listSessions,
  toSessionSummary: hermes.toSessionSummary,
  updateSession: vi.fn(),
}))

vi.mock('../../server/local-session-store', () => ({
  deleteLocalSession: localStore.deleteLocalSession,
  getLocalSession: localStore.getLocalSession,
  listLocalSessions: localStore.listLocalSessions,
  updateLocalSessionTitle: localStore.updateLocalSessionTitle,
}))

vi.mock('@/lib/feature-gates', () => ({
  createCapabilityUnavailablePayload: vi.fn(() => ({ ok: false })),
}))

async function getHandler() {
  vi.resetModules()
  const mod = await import('./sessions')
  return (mod.Route as unknown as { options: { server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } } } }).options.server.handlers.GET
}

describe('GET /api/sessions', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('pages through all backend sessions before returning the merged list', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({ sessions: true })
    hermes.listSessions
      .mockResolvedValueOnce(Array.from({ length: 1000 }, (_, i) => ({ id: `s-${i}` })))
      .mockResolvedValueOnce([{ id: 's-1000' }, { id: 's-1001' }])
    hermes.toSessionSummary.mockImplementation((session: { id: string }) => ({
      id: session.id,
      key: session.id,
      friendlyId: session.id,
    }))
    localStore.listLocalSessions.mockReturnValue([])

    const handler = await getHandler()
    const res = await handler({ request: new Request('http://localhost/api/sessions') })
    const body = await res.json() as { sessions: Array<{ id: string }> }

    expect(res.status).toBe(200)
    expect(hermes.listSessions).toHaveBeenNthCalledWith(1, 1000, 0)
    expect(hermes.listSessions).toHaveBeenNthCalledWith(2, 1000, 1000)
    expect(body.sessions).toHaveLength(1002)
    expect(body.sessions.at(-1)?.id).toBe('s-1001')
  })

  it('honors an explicit page instead of exhausting the backend', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({ sessions: true })
    hermes.listSessions.mockResolvedValue([{ id: 's-200' }])
    hermes.toSessionSummary.mockImplementation((session: { id: string }) => ({
      id: session.id,
      key: session.id,
      friendlyId: session.id,
    }))
    localStore.listLocalSessions.mockReturnValue([])

    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/sessions?limit=200&offset=200'),
    })
    const body = (await res.json()) as { sessions: Array<{ id: string }> }

    expect(res.status).toBe(200)
    expect(hermes.listSessions).toHaveBeenCalledTimes(1)
    expect(hermes.listSessions).toHaveBeenCalledWith(200, 200)
    expect(body.sessions).toEqual([{ id: 's-200', key: 's-200', friendlyId: 's-200' }])
  })
})
