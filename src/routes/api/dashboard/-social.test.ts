import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../../server/auth-middleware'
import {
  dashboardFetch,
  gatewayFetch,
} from '../../../server/gateway-capabilities'
import { getMnemosyneActivity } from '../../../server/mnemosyne-browser'

const { Route } = await import('./social')

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../../server/gateway-capabilities', () => ({
  dashboardFetch: vi.fn(),
  gatewayFetch: vi.fn(),
}))

vi.mock('../../../server/mnemosyne-browser', () => ({
  getMnemosyneActivity: vi.fn(),
}))

const handlers = (Route as any).options.server.handlers

const base = 'http://localhost/api/dashboard/social'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Minimal happy-path upstreams — depth lives in dashboard-social.test.ts. */
function stubUpstreams(): void {
  vi.mocked(dashboardFetch).mockImplementation((path: string) => {
    if (path.startsWith('/api/profiles/sessions')) {
      return Promise.resolve(
        jsonResponse({
          sessions: [
            {
              id: 's_1',
              profile: 'default',
              title: 'hello world',
              started_at: 1,
              last_active: 2,
            },
          ],
          total: 1,
          profile_totals: { default: 1 },
        }),
      )
    }
    if (path.startsWith('/api/cron/jobs'))
      return Promise.resolve(jsonResponse({ jobs: [] }))
    if (path.startsWith('/api/plugins/workflow-engine/runs?')) {
      return Promise.resolve(jsonResponse({ runs: [] }))
    }
    if (path.includes('/nodes'))
      return Promise.resolve(jsonResponse({ nodeRuns: [] }))
    if (path.startsWith('/api/plugins/workflow-engine/definitions')) {
      return Promise.resolve(jsonResponse({ definitions: [] }))
    }
    if (path.startsWith('/api/plugins/karpathy-self-improve/experiments')) {
      return Promise.resolve(jsonResponse({ experiments: [] }))
    }
    if (path.startsWith('/api/plugins/hermes-achievements')) {
      return Promise.resolve(jsonResponse({ achievements: [], unlocks: [] }))
    }
    if (path.startsWith('/api/analytics/usage')) {
      return Promise.resolve(jsonResponse({ totals: {}, daily: [] }))
    }
    if (path.startsWith('/api/plugins/kanban/board')) {
      return Promise.resolve(jsonResponse({ board: { columns: [] } }))
    }
    if (path.startsWith('/api/status')) {
      return Promise.resolve(jsonResponse({ profiles: ['default'] }))
    }
    return Promise.reject(new Error(`unexpected dashboard path: ${path}`))
  })
  vi.mocked(gatewayFetch).mockResolvedValue(
    jsonResponse({ gateway_state: 'running' }),
  )
  vi.mocked(getMnemosyneActivity).mockReturnValue({
    days: [],
    totals: { gist: 0, fact: 5, episodic: 0, working: 0, entity: 0 },
    junkFacts: 0,
  })
}

describe('GET /api/dashboard/social', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without auth', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)
    const res = await handlers.GET({ request: new Request(base) } as any)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'Unauthorized' })
    expect(dashboardFetch).not.toHaveBeenCalled()
  })

  it('returns 200 with the C1 top-level keys when authed', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    stubUpstreams()

    const res = await handlers.GET({
      request: new Request(base),
    } as any)

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('private')
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(
      [
        'profile',
        'generatedAt',
        'operator',
        'agents',
        'hotTopics',
        'counts',
        'needsYou',
        'recent',
        'badges',
      ].sort(),
    )
    expect(body.profile).toBeNull()
    expect(body.operator).not.toBeNull()
    expect(Array.isArray(body.badges)).toBe(true)
    expect(body.badges).toHaveLength(12)
    // Memory is served locally through the composite fetcher.
    expect(getMnemosyneActivity).toHaveBeenCalled()
  })

  it('honours ?profile= and forwards it to every upstream call', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    stubUpstreams()

    const res = await handlers.GET({
      request: new Request(`${base}?profile=neo`),
    } as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.profile).toBe('neo')
    for (const call of vi.mocked(dashboardFetch).mock.calls) {
      expect(call[0]).toContain('profile=neo')
    }
  })
})
