import { afterEach, describe, expect, it, vi } from 'vitest'

const hermes = vi.hoisted(() => ({
  ensureGatewayProbed: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(),
  searchSessions: vi.fn(),
  toSessionSummary: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
}))

const dashboard = vi.hoisted(() => ({
  listProfileSessions: vi.fn(),
}))

vi.mock('../../server/claude-dashboard-api', () => ({
  listProfileSessions: dashboard.listProfileSessions,
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
  createSession: hermes.createSession,
  deleteSession: hermes.deleteSession,
  ensureGatewayProbed: hermes.ensureGatewayProbed,
  getGatewayCapabilities: vi.fn(),
  getSession: hermes.getSession,
  listSessions: hermes.listSessions,
  searchSessions: hermes.searchSessions,
  toSessionSummary: hermes.toSessionSummary,
  updateSession: hermes.updateSession,
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

// Fully mocked (not a partial/importOriginal spread): vi.resetModules() in
// getHandlers() would otherwise re-evaluate `actual` on every test, making
// error-class identity unstable across `isProfileScopeError` checks. The
// route's plumbing is what's under test here — the real fail-closed logic
// has its own coverage in profile-scope.test.ts.
class FakeProfileScopeError extends Error {}
const profileScope = vi.hoisted(() => ({
  readProfile: vi.fn(),
  assertProfileServed: vi.fn(),
  isProfileScopeError: vi.fn(),
  profileErrorStatus: vi.fn(),
}))

vi.mock('../../server/profile-scope', () => ({
  readProfile: profileScope.readProfile,
  assertProfileServed: profileScope.assertProfileServed,
  isProfileScopeError: profileScope.isProfileScopeError,
  profileErrorStatus: profileScope.profileErrorStatus,
}))

type Handler = (ctx: { request: Request }) => Promise<Response>

async function getHandlers() {
  vi.resetModules()
  const mod = await import('./sessions')
  return (
    mod.Route as unknown as {
      options: { server: { handlers: Record<string, Handler> } }
    }
  ).options.server.handlers
}

async function getHandler() {
  return (await getHandlers()).GET
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

  it('fetches one requested session from its explicit profile', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({ sessions: true })
    profileScope.readProfile.mockImplementationOnce(realReadProfile)
    localStore.getLocalSession.mockReturnValue(null)
    hermes.getSession.mockResolvedValue({ id: 'same-id' })
    hermes.toSessionSummary.mockReturnValue({
      key: 'same-id',
      friendlyId: 'same-id',
    })

    const handler = await getHandler()
    const res = await handler({
      request: new Request(
        'http://localhost/api/sessions?sessionKey=same-id&profile=morpheus',
      ),
    })
    const body = (await res.json()) as {
      sessions: Array<{ profile?: string }>
    }

    expect(res.status).toBe(200)
    expect(hermes.getSession).toHaveBeenCalledWith('same-id', 'morpheus')
    expect(dashboard.listProfileSessions).not.toHaveBeenCalled()
    expect(body.sessions[0]?.profile).toBe('morpheus')
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

    // Third arg is the scoped profile; `readProfile` is mocked and returns
    // undefined here, i.e. unscoped — which reaches the wire untouched.
    expect(hermes.searchSessions).toHaveBeenCalledWith('needle', 20, undefined)
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

// The route-level lane the P4 (client `fetch` mocks) and sidebar (module
// mocks of `sessions-feed`) suites both skip: nothing there executes this
// handler, so the route silently lost its profile scoping while the whole
// suite stayed green.
const realReadProfile = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null

describe('GET /api/sessions?profile=', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('routes a scoped read to the dashboard aggregation, never the unscoped listing', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({ sessions: true })
    profileScope.readProfile.mockImplementation(realReadProfile)
    dashboard.listProfileSessions.mockResolvedValue({
      sessions: [{ id: 'neo-1', source: null, profile: 'neo' }],
      total: 1,
      profile_totals: { neo: 306, default: 12 },
      limit: 1,
      offset: 0,
    })
    hermes.toSessionSummary.mockImplementation((s: { id: string }) => ({
      key: s.id,
      friendlyId: s.id,
    }))

    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/sessions?profile=all&limit=1'),
    })
    const body = (await res.json()) as {
      sessions: Array<{ key: string; profile?: string }>
      profile_totals?: Record<string, number>
    }

    expect(res.status).toBe(200)
    expect(dashboard.listProfileSessions).toHaveBeenCalledWith('all', 1, 0)
    // The unscoped active-profile listing is the silent wrong-profile hazard.
    expect(hermes.listSessions).not.toHaveBeenCalled()
    expect(body.profile_totals).toEqual({ neo: 306, default: 12 })
    expect(body.sessions).toEqual([
      { key: 'neo-1', friendlyId: 'neo-1', profile: 'neo' },
    ])
  })

  it('passes the dashboard errors[] through so a schema-drifted profile reads as degraded, not as 0', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({ sessions: true })
    profileScope.readProfile.mockImplementation(realReadProfile)
    dashboard.listProfileSessions.mockResolvedValue({
      sessions: [],
      total: 0,
      // `neo` really has 306 sessions; the dashboard could not count them.
      profile_totals: { default: 12 },
      errors: [{ profile: 'neo', error: 'no such column: s.display_name' }],
      limit: 1,
      offset: 0,
    })

    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/sessions?profile=all&limit=1'),
    })
    const body = (await res.json()) as {
      profile_totals?: Record<string, number>
      errors?: Array<{ profile: string; error: string }>
    }

    // Exactly the shape `fetchProfileTotals`/`useProfileSessionTotals` in
    // src/screens/chat/sessions-feed.ts reads: top-level `profile_totals`
    // plus `errors[{profile,error}]`. A missing `errors` entry would make the
    // sidebar render `neo` as an empty profile — a lie.
    expect(body.profile_totals).toEqual({ default: 12 })
    expect(body.errors).toEqual([
      { profile: 'neo', error: 'no such column: s.display_name' },
    ])
  })

  it('surfaces an unavailable dashboard as an error instead of falling back to unscoped data', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({ sessions: true })
    profileScope.readProfile.mockImplementation(realReadProfile)
    dashboard.listProfileSessions.mockRejectedValue(
      new Error('Hermes Agent dashboard /api/profiles/sessions: 503'),
    )

    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/sessions?profile=neo'),
    })

    expect(res.status).toBe(500)
    expect(hermes.listSessions).not.toHaveBeenCalled()
  })

  it('stays byte-identical when unscoped: never touches the profile listing', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({ sessions: true })
    profileScope.readProfile.mockImplementation(realReadProfile)
    hermes.listSessions.mockResolvedValue([{ id: 's-1' }])
    hermes.toSessionSummary.mockImplementation((s: { id: string }) => ({
      key: s.id,
      friendlyId: s.id,
    }))
    localStore.listLocalSessions.mockReturnValue([])

    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/sessions?limit=10'),
    })
    const body = (await res.json()) as { sessions: Array<{ key: string }> }

    expect(res.status).toBe(200)
    expect(dashboard.listProfileSessions).not.toHaveBeenCalled()
    expect(hermes.listSessions).toHaveBeenCalledWith(10, 0)
    expect(body.sessions).toEqual([{ key: 's-1', friendlyId: 's-1' }])
  })
})

describe('POST /api/sessions', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  const postRequest = (body: Record<string, unknown>) =>
    new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('fails closed before creating anything when the profile cannot be proven routable', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({
      sessions: true,
      dashboard: { available: true },
      enhancedChat: false,
    })
    profileScope.readProfile.mockReturnValue('work')
    profileScope.assertProfileServed.mockRejectedValue(
      new FakeProfileScopeError('profile "work" is not served'),
    )
    profileScope.isProfileScopeError.mockReturnValue(true)
    profileScope.profileErrorStatus.mockReturnValue(404)

    const handler = (await getHandlers()).POST
    const res = await handler({
      request: postRequest({ label: 'New Chat', profile: 'work' }),
    })
    const body = (await res.json()) as { ok: boolean; error?: string }

    expect(res.status).toBe(404)
    expect(body).toEqual({ ok: false, error: 'profile "work" is not served' })
    expect(hermes.createSession).not.toHaveBeenCalled()
  })

  it('skips the unscoped dashboard shortcut and threads the profile into createSession', async () => {
    // dashboard.available && !enhancedChat is exactly the branch that returns
    // a non-persisted session without ever naming a profile.
    hermes.ensureGatewayProbed.mockResolvedValue({
      sessions: true,
      dashboard: { available: true },
      enhancedChat: false,
    })
    profileScope.readProfile.mockReturnValue('work')
    profileScope.assertProfileServed.mockResolvedValue(undefined)
    hermes.createSession.mockResolvedValue({ id: 'sess-9' })
    hermes.toSessionSummary.mockReturnValue({
      key: 'sess-9',
      friendlyId: 'sess-9',
    })

    const handler = (await getHandlers()).POST
    const res = await handler({
      request: postRequest({
        label: 'New Chat',
        friendlyId: 'sess-9',
        model: 'sonnet',
        profile: 'work',
      }),
    })
    const body = (await res.json()) as { persisted?: boolean; entry?: unknown }

    expect(res.status).toBe(200)
    expect(body.persisted).toBeUndefined()
    expect(hermes.createSession).toHaveBeenCalledWith(
      { id: 'sess-9', title: 'New Chat', model: 'sonnet' },
      'work',
    )
  })

  it('stays byte-identical when unscoped: keeps the dashboard shortcut and skips the probe', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({
      sessions: true,
      dashboard: { available: true },
      enhancedChat: false,
    })
    profileScope.readProfile.mockReturnValue(null)

    const handler = (await getHandlers()).POST
    const res = await handler({
      request: postRequest({ label: 'New Chat', friendlyId: 'sess-9' }),
    })
    const body = (await res.json()) as { persisted?: boolean }

    expect(res.status).toBe(200)
    expect(body.persisted).toBe(false)
    expect(profileScope.assertProfileServed).not.toHaveBeenCalled()
    expect(hermes.createSession).not.toHaveBeenCalled()
  })

  it('passes a null profile through to createSession on the gateway path when unscoped', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({
      sessions: true,
      dashboard: { available: false },
      enhancedChat: true,
    })
    profileScope.readProfile.mockReturnValue(null)
    hermes.createSession.mockResolvedValue({ id: 'sess-9' })
    hermes.toSessionSummary.mockReturnValue({ key: 'sess-9' })

    const handler = (await getHandlers()).POST
    const res = await handler({
      request: postRequest({ label: 'New Chat', friendlyId: 'sess-9' }),
    })

    expect(res.status).toBe(200)
    expect(profileScope.assertProfileServed).not.toHaveBeenCalled()
    expect(hermes.createSession).toHaveBeenCalledWith(
      { id: 'sess-9', title: 'New Chat', model: undefined },
      null,
    )
  })
})

describe('PATCH /api/sessions', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed before any mutation when the profile cannot be proven routable', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({
      sessions: true,
      dashboard: { available: false },
      enhancedChat: true,
    })
    profileScope.readProfile.mockReturnValue('work')
    profileScope.assertProfileServed.mockRejectedValue(
      new FakeProfileScopeError('profile "work" is not served'),
    )
    profileScope.isProfileScopeError.mockReturnValue(true)
    profileScope.profileErrorStatus.mockReturnValue(404)

    const handler = (await getHandlers()).PATCH
    const res = await handler({
      request: new Request('http://localhost/api/sessions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionKey: 'sess-1',
          label: 'New Title',
          profile: 'work',
        }),
      }),
    })
    const body = (await res.json()) as { ok: boolean; error?: string }

    expect(res.status).toBe(404)
    expect(body).toEqual({ ok: false, error: 'profile "work" is not served' })
    // Neither the local store nor the gateway may have been touched.
    expect(localStore.getLocalSession).not.toHaveBeenCalled()
    expect(hermes.updateSession).not.toHaveBeenCalled()
  })

  it('threads the profile through to updateSession on success', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({
      sessions: true,
      dashboard: { available: false },
      enhancedChat: true,
    })
    profileScope.readProfile.mockReturnValue('work')
    profileScope.assertProfileServed.mockResolvedValue(undefined)
    localStore.getLocalSession.mockReturnValue(null)
    hermes.updateSession.mockResolvedValue({ id: 'sess-1', title: 'New Title' })
    hermes.toSessionSummary.mockReturnValue({
      key: 'sess-1',
      friendlyId: 'sess-1',
    })

    const handler = (await getHandlers()).PATCH
    const res = await handler({
      request: new Request('http://localhost/api/sessions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionKey: 'sess-1',
          label: 'New Title',
          profile: 'work',
        }),
      }),
    })

    expect(res.status).toBe(200)
    expect(hermes.updateSession).toHaveBeenCalledWith(
      'sess-1',
      { title: 'New Title' },
      'work',
    )
  })

  it('stays byte-identical when unscoped: skips the profile probe entirely', async () => {
    hermes.ensureGatewayProbed.mockResolvedValue({
      sessions: true,
      dashboard: { available: false },
      enhancedChat: true,
    })
    profileScope.readProfile.mockReturnValue(null)
    localStore.getLocalSession.mockReturnValue(null)
    hermes.updateSession.mockResolvedValue({ id: 'sess-1', title: 'New Title' })
    hermes.toSessionSummary.mockReturnValue({
      key: 'sess-1',
      friendlyId: 'sess-1',
    })

    const handler = (await getHandlers()).PATCH
    const res = await handler({
      request: new Request('http://localhost/api/sessions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionKey: 'sess-1', label: 'New Title' }),
      }),
    })

    expect(res.status).toBe(200)
    expect(profileScope.assertProfileServed).not.toHaveBeenCalled()
    expect(hermes.updateSession).toHaveBeenCalledWith(
      'sess-1',
      { title: 'New Title' },
      null,
    )
  })
})

describe('DELETE /api/sessions', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed before any mutation when the profile cannot be proven routable', async () => {
    profileScope.readProfile.mockReturnValue('work')
    profileScope.assertProfileServed.mockRejectedValue(
      new FakeProfileScopeError('profile "work" is not served'),
    )
    profileScope.isProfileScopeError.mockReturnValue(true)
    profileScope.profileErrorStatus.mockReturnValue(404)

    const handler = (await getHandlers()).DELETE
    const res = await handler({
      request: new Request('http://localhost/api/sessions?sessionKey=sess-1', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: 'work' }),
      }),
    })
    const body = (await res.json()) as { ok: boolean; error?: string }

    expect(res.status).toBe(404)
    expect(body).toEqual({ ok: false, error: 'profile "work" is not served' })
    // Fail-closed happens before the gateway topology is even probed, and
    // before either the local or gateway delete path is touched.
    expect(hermes.ensureGatewayProbed).not.toHaveBeenCalled()
    expect(localStore.getLocalSession).not.toHaveBeenCalled()
    expect(hermes.deleteSession).not.toHaveBeenCalled()
  })

  it('threads the profile through to deleteSession on success', async () => {
    profileScope.readProfile.mockReturnValue('work')
    profileScope.assertProfileServed.mockResolvedValue(undefined)
    localStore.getLocalSession.mockReturnValue(null)
    hermes.ensureGatewayProbed.mockResolvedValue({ sessions: true })
    hermes.deleteSession.mockResolvedValue(undefined)

    const handler = (await getHandlers()).DELETE
    const res = await handler({
      request: new Request('http://localhost/api/sessions?sessionKey=sess-1', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: 'work' }),
      }),
    })

    expect(res.status).toBe(200)
    expect(hermes.deleteSession).toHaveBeenCalledWith('sess-1', 'work')
  })

  it('stays byte-identical when unscoped: skips the profile probe entirely', async () => {
    profileScope.readProfile.mockReturnValue(null)
    localStore.getLocalSession.mockReturnValue(null)
    hermes.ensureGatewayProbed.mockResolvedValue({ sessions: true })
    hermes.deleteSession.mockResolvedValue(undefined)

    const handler = (await getHandlers()).DELETE
    const res = await handler({
      request: new Request('http://localhost/api/sessions?sessionKey=sess-1', {
        method: 'DELETE',
      }),
    })

    expect(res.status).toBe(200)
    expect(profileScope.assertProfileServed).not.toHaveBeenCalled()
    expect(hermes.deleteSession).toHaveBeenCalledWith('sess-1', null)
  })
})
