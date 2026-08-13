import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import {
  ensureGatewayProbed,
  getCapabilities,
  getGatewayMode,
} from '../../server/gateway-capabilities'
import { getGatewayMode as getGatewayScopeMode } from '../../server/profile-scope'
import { getActiveProfileName } from '../../server/profiles-browser'
import { listProfileSessions } from '../../server/claude-dashboard-api'
import { Route } from './gateway-status'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/gateway-capabilities', () => ({
  CLAUDE_API: 'http://127.0.0.1:8642',
  CLAUDE_DASHBOARD_URL: 'http://127.0.0.1:9119',
  ensureGatewayProbed: vi.fn(),
  getCapabilities: vi.fn(),
  getGatewayMode: vi.fn(),
}))

vi.mock('../../server/profile-scope', () => ({
  getGatewayMode: vi.fn(),
}))

vi.mock('../../server/profiles-browser', () => ({
  getActiveProfileName: vi.fn(() => 'default'),
}))

vi.mock('../../server/claude-dashboard-api', () => ({
  listProfileSessions: vi.fn(() => Promise.resolve({ profile_totals: {} })),
}))

type RouteWithHandlers = typeof Route & {
  options: {
    server: {
      handlers: {
        GET: (ctx: { request: Request }) => Promise<Response>
      }
    }
  }
}

const handler = (Route as RouteWithHandlers).options.server.handlers.GET

const baseCapabilities = {
  health: true,
  chatCompletions: true,
  models: true,
  streaming: true,
  probed: true,
  authError: false,
  sessions: false,
  enhancedChat: false,
  skills: false,
  memory: true,
  config: false,
  jobs: false,
  mcp: false,
  mcpFallback: false,
  conductor: false,
  kanban: false,
  projects: false,
  agentCommands: false,
  dashboard: { available: false, url: 'http://127.0.0.1:9119' },
}

describe('GET /api/gateway-status', () => {
  beforeEach(() => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(ensureGatewayProbed).mockResolvedValue(baseCapabilities)
    vi.mocked(getCapabilities).mockReturnValue(baseCapabilities)
    vi.mocked(getGatewayMode).mockReturnValue('zero-fork')
    vi.mocked(getActiveProfileName).mockReturnValue('default')
    vi.mocked(listProfileSessions).mockResolvedValue({
      profile_totals: {},
    } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)
    const res = await handler({ request: new Request('http://x/api/gateway-status') })
    expect(res.status).toBe(401)
  })

  it('forwards servingProfile — the fact W3 audit item 1 found being dropped', async () => {
    vi.mocked(getGatewayScopeMode).mockResolvedValue({
      mode: 'single',
      servedProfiles: null,
      activeProfile: 'hermes-switch',
    } as never)

    const res = await handler({ request: new Request('http://x/api/gateway-status') })
    const body = (await res.json()) as {
      scope: { mode: string; servingProfile: string | null }
    }

    expect(body.scope.mode).toBe('single')
    expect(body.scope.servingProfile).toBe('hermes-switch')
  })

  it('reports servingProfile as null under multiplex (meaningless there)', async () => {
    vi.mocked(getGatewayScopeMode).mockResolvedValue({
      mode: 'multiplex',
      servedProfiles: ['default', 'neo'],
      activeProfile: null,
    } as never)

    const res = await handler({ request: new Request('http://x/api/gateway-status') })
    const body = (await res.json()) as { scope: { servingProfile: string | null } }

    expect(body.scope.servingProfile).toBeNull()
  })

  it('forwards the per-profile gateway roster so the picker can mark what nothing serves', async () => {
    vi.mocked(getGatewayScopeMode).mockResolvedValue({
      mode: 'single',
      servedProfiles: null,
      activeProfile: 'default',
      profileGateways: [
        { profile: 'default', apiPort: 8642, matchesConfiguredApi: true },
        { profile: 'hermes-switch', apiPort: null, matchesConfiguredApi: false },
      ],
    } as never)

    const res = await handler({ request: new Request('http://x/api/gateway-status') })
    const body = (await res.json()) as {
      scope: {
        servingProfile: string | null
        reason: string | null
        profileGateways: Array<{ profile: string; apiPort: number | null }>
      }
    }

    expect(body.scope.servingProfile).toBe('default')
    expect(body.scope.reason).toBeNull()
    expect(body.scope.profileGateways).toEqual([
      { profile: 'default', apiPort: 8642, matchesConfiguredApi: true },
      { profile: 'hermes-switch', apiPort: null, matchesConfiguredApi: false },
    ])
  })

  it('forwards the "unknown" reason so the UI never mislabels a healthy dashboard as unreachable', async () => {
    vi.mocked(getGatewayScopeMode).mockResolvedValue({
      mode: 'unknown',
      servedProfiles: null,
      activeProfile: null,
      reason: 'multiple-gateways',
      profileGateways: [
        { profile: 'neo', apiPort: 8700, matchesConfiguredApi: false },
      ],
    } as never)

    const res = await handler({ request: new Request('http://x/api/gateway-status') })
    const body = (await res.json()) as { scope: { reason: string | null } }

    expect(body.scope.reason).toBe('multiple-gateways')
  })

  it('gateway.available is false when authError is true, even though health/chatCompletions read true', async () => {
    const caps = { ...baseCapabilities, authError: true }
    vi.mocked(ensureGatewayProbed).mockResolvedValue(caps)
    vi.mocked(getGatewayScopeMode).mockResolvedValue({
      mode: 'unknown',
      servedProfiles: null,
      activeProfile: null,
      reason: 'probe-failed',
    } as never)

    const res = await handler({ request: new Request('http://x/api/gateway-status') })
    const body = (await res.json()) as {
      gateway: { available: boolean; authError: boolean }
    }

    expect(body.gateway.authError).toBe(true)
    expect(body.gateway.available).toBe(false)
  })

  it('gateway.available is true when healthy and authError is false', async () => {
    vi.mocked(getGatewayScopeMode).mockResolvedValue({
      mode: 'single',
      servedProfiles: null,
      activeProfile: 'default',
    } as never)

    const res = await handler({ request: new Request('http://x/api/gateway-status') })
    const body = (await res.json()) as { gateway: { available: boolean } }

    expect(body.gateway.available).toBe(true)
  })
})
