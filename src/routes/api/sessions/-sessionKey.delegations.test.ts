import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts as object,
}))

vi.mock('../../../server/auth-middleware', () => ({ isAuthenticated: () => true }))

const profileScope = vi.hoisted(() => ({
  isProfileScopeError: vi.fn(),
  profileErrorStatus: vi.fn(() => 409),
}))

vi.mock('../../../server/profile-scope', () => ({
  isProfileScopeError: profileScope.isProfileScopeError,
  profileErrorStatus: profileScope.profileErrorStatus,
}))

const hermes = vi.hoisted(() => ({
  getSession: vi.fn(async (id: string) => ({ id, title: 'Session' })),
  ensureGatewayProbed: vi.fn(async () => ({ sessions: true })),
  getGatewayCapabilities: vi.fn(() => ({ sessions: true })),
}))

vi.mock('../../../server/hermes-api', () => ({
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'unavailable',
  ensureGatewayProbed: hermes.ensureGatewayProbed,
  getGatewayCapabilities: hermes.getGatewayCapabilities,
  getSession: hermes.getSession,
}))

const delegationsMock = vi.hoisted(() => ({
  readDelegationsForParent: vi.fn(() => [{ childSessionId: 'child-1', status: 'completed' }]),
}))

vi.mock('../../../server/delegations', () => ({
  DelegationProfileUnavailableError: class extends Error {
    profile: string
    constructor(profile: string) {
      super(`Delegation profile ${profile} unavailable`)
      this.name = 'DelegationProfileUnavailableError'
      this.profile = profile
    }
  },
  readDelegationsForParent: delegationsMock.readDelegationsForParent,
}))

async function get(sessionKey: string, query = '') {
  const route = (await import('./$sessionKey.delegations')).Route as unknown as {
    server: {
      handlers: {
        GET: (ctx: { request: Request; params: { sessionKey: string } }) => Promise<Response>
      }
    }
  }
  return route.server.handlers.GET({
    request: new Request(`http://localhost/api/sessions/${sessionKey}/delegations${query ? `?${query}` : ''}`),
    params: { sessionKey },
  })
}

describe('GET /api/sessions/$sessionKey/delegations', () => {
  beforeEach(() => {
    vi.resetModules()
    hermes.getSession.mockClear()
    delegationsMock.readDelegationsForParent.mockClear()
    profileScope.isProfileScopeError.mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty delegations for draft sessionKey "new"', async () => {
    const res = await get('new')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; delegations: Array<unknown> }
    expect(body).toEqual({ ok: true, delegations: [] })
    expect(hermes.getSession).not.toHaveBeenCalled()
  })

  it('returns delegations for existing sessionKey', async () => {
    const res = await get('session-123')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; delegations: Array<unknown> }
    expect(body.ok).toBe(true)
    expect(body.delegations).toHaveLength(1)
    expect(hermes.getSession).toHaveBeenCalledWith('session-123', null)
  })

  it('returns 409 when profile scope error is thrown', async () => {
    profileScope.isProfileScopeError.mockReturnValue(true)
    hermes.getSession.mockRejectedValueOnce(new Error('Profile neo unavailable'))
    const res = await get('session-123', 'profile=neo')
    expect(res.status).toBe(409)
    const body = (await res.json()) as { ok: boolean; unavailable: boolean; profile: string }
    expect(body.ok).toBe(false)
    expect(body.unavailable).toBe(true)
    expect(body.profile).toBe('neo')
  })
})
