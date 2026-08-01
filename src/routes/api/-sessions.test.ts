import { afterEach, describe, expect, it, vi } from 'vitest'

const hermes = vi.hoisted(() => ({
  ensureGatewayProbed: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(),
  searchSessions: vi.fn(),
  toSessionSummary: vi.fn(),
}))

const localStore = vi.hoisted(() => ({
  listLocalSessions: vi.fn(),
  getLocalSession: vi.fn(),
  updateLocalSessionTitle: vi.fn(),
  deleteLocalSession: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => ({
    options: opts,
    ...(opts as object),
  }),
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
  getSession: hermes.getSession,
  listSessions: hermes.listSessions,
  searchSessions: hermes.searchSessions,
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
  return (
    mod.Route as unknown as {
      options: {
        server: {
          handlers: { GET: (ctx: { request: Request }) => Promise<Response> }
        }
      }
    }
  ).options.server.handlers.GET
}

describe('GET /api/sessions', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('pages through all backend sessions before returning the merged list', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({ sessions: true })
    hermes.listSessions
      .mockResolvedValueOnce(
        Array.from({ length: 1000 }, (_, i) => ({ id: `s-${i}` })),
      )
      .mockResolvedValueOnce([{ id: 's-1000' }, { id: 's-1001' }])
    hermes.toSessionSummary.mockImplementation((session: { id: string }) => ({
      id: session.id,
      key: session.id,
      friendlyId: session.id,
    }))
    localStore.listLocalSessions.mockReturnValue([])

    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/sessions'),
    })
    const body = (await res.json()) as { sessions: Array<{ id: string }> }

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
      request: new Request(
        'http://localhost/api/sessions?limit=200&offset=200',
      ),
    })
    const body = (await res.json()) as { sessions: Array<{ id: string }> }

    expect(res.status).toBe(200)
    expect(hermes.listSessions).toHaveBeenCalledTimes(1)
    expect(hermes.listSessions).toHaveBeenCalledWith(200, 200)
    expect(body.sessions).toEqual([
      { id: 's-200', key: 's-200', friendlyId: 's-200' },
    ])
  })

  it('keeps paginated responses within the requested limit when local sessions exist', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({ sessions: true })
    hermes.listSessions.mockResolvedValue([
      { id: 'gateway-new', updatedAt: 300 },
      { id: 'gateway-old', updatedAt: 100 },
    ])
    hermes.toSessionSummary.mockImplementation(
      (session: { id: string; updatedAt: number }) => ({
        id: session.id,
        key: session.id,
        friendlyId: session.id,
        updatedAt: session.updatedAt,
      }),
    )
    localStore.listLocalSessions.mockReturnValue([
      {
        id: 'local-new',
        title: 'Local',
        createdAt: 200,
        updatedAt: 200,
        messageCount: 1,
        model: 'local',
      },
    ])

    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/sessions?limit=2&offset=0'),
    })
    const body = (await res.json()) as { sessions: Array<{ id: string }> }

    expect(hermes.listSessions).toHaveBeenCalledWith(3, 0)
    expect(body.sessions.map((session) => session.id)).toEqual([
      'gateway-new',
      'local-new',
    ])
  })

  it('fetches one requested session without listing every page', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({ sessions: true })
    hermes.getSession.mockResolvedValue({ id: 'older-session' })
    hermes.toSessionSummary.mockReturnValue({
      key: 'older-session',
      friendlyId: 'older-session',
    })
    localStore.getLocalSession.mockReturnValue(null)

    const handler = await getHandler()
    const res = await handler({
      request: new Request(
        'http://localhost/api/sessions?sessionKey=older-session',
      ),
    })
    const body = (await res.json()) as { sessions: Array<{ key: string }> }

    expect(hermes.getSession).toHaveBeenCalledWith('older-session')
    expect(hermes.listSessions).not.toHaveBeenCalled()
    expect(body.sessions).toEqual([
      { key: 'older-session', friendlyId: 'older-session' },
    ])
  })

  it('returns session summaries for server-side search results', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({ sessions: true })
    hermes.searchSessions.mockResolvedValue({
      results: [
        { session_id: 'matching-session', snippet: 'matching content' },
        { session_id: 'matching-session' },
      ],
    })
    hermes.getSession.mockResolvedValue({ id: 'matching-session' })
    hermes.toSessionSummary.mockReturnValue({
      key: 'matching-session',
      friendlyId: 'matching-session',
    })

    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/sessions?q=needle'),
    })
    const body = (await res.json()) as { sessions: Array<{ key: string }> }

    expect(hermes.searchSessions).toHaveBeenCalledWith('needle', 20)
    expect(hermes.getSession).toHaveBeenCalledTimes(1)
    expect(hermes.listSessions).not.toHaveBeenCalled()
    expect(body.sessions).toEqual([
      {
        key: 'matching-session',
        friendlyId: 'matching-session',
        preview: 'matching content',
      },
    ])
  })
})
