import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { ensureGatewayProbed } from '../../server/gateway-capabilities'
import {
  getHermesCommandCatalog,
  hermesCommandCatalogCachedAt,
} from '../../server/hermes-commands'
import { Route } from './hermes-commands'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/gateway-capabilities', () => ({
  CLAUDE_DASHBOARD_URL: 'http://127.0.0.1:9119',
  ensureGatewayProbed: vi.fn(),
}))

vi.mock('../../server/hermes-commands', () => ({
  getHermesCommandCatalog: vi.fn(),
  hermesCommandCatalogCachedAt: vi.fn(() => 1_700_000_000_000),
}))

type RouteWithHandlers = typeof Route & {
  options: {
    server: {
      handlers: { GET: (ctx: { request: Request }) => Promise<Response> }
    }
  }
}

const handler = (Route as RouteWithHandlers).options.server.handlers.GET

const request = () => new Request('http://x/api/hermes-commands')

const capabilities = (overrides: Record<string, unknown> = {}) =>
  ({
    agentCommands: true,
    dashboard: { available: true, url: 'http://127.0.0.1:9119' },
    ...overrides,
  }) as never

const catalog = {
  commands: [
    { command: '/branch', description: 'Fork', category: 'Session', tier: 'local' },
    { command: '/yolo', description: 'Yolo', category: 'Configuration', tier: 'excluded' },
  ],
  categories: ['Session', 'Configuration'],
  aliases: { '/fork': '/branch' },
  skillCount: 79,
  warning: '',
}

describe('GET /api/hermes-commands', () => {
  beforeEach(() => {
    // The mocks are module-factory vi.fn()s; restoreAllMocks does not clear
    // their call history, and two cases below assert "never called".
    vi.clearAllMocks()
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(ensureGatewayProbed).mockResolvedValue(capabilities())
    vi.mocked(getHermesCommandCatalog).mockResolvedValue(catalog as never)
    vi.mocked(hermesCommandCatalogCachedAt).mockReturnValue(1_700_000_000_000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)
    const res = await handler({ request: request() })

    expect(res.status).toBe(401)
    expect(getHermesCommandCatalog).not.toHaveBeenCalled()
  })

  it('serves the normalized catalog with server-computed tiers', async () => {
    const res = await handler({ request: request() })
    const body = (await res.json()) as {
      ok: boolean
      commands: Array<{ command: string; tier: string }>
      categories: Array<string>
      aliases: Record<string, string>
      skillCount: number
      cachedAt: number
    }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.commands.map((c) => [c.command, c.tier])).toEqual([
      ['/branch', 'local'],
      ['/yolo', 'excluded'],
    ])
    expect(body.categories).toEqual(['Session', 'Configuration'])
    expect(body.aliases).toEqual({ '/fork': '/branch' })
    expect(body.skillCount).toBe(79)
    expect(body.cachedAt).toBe(1_700_000_000_000)
  })

  it('degrades to 503 with a machine-readable mode when the dashboard is absent', async () => {
    vi.mocked(ensureGatewayProbed).mockResolvedValue(
      capabilities({
        agentCommands: false,
        dashboard: { available: false, url: 'http://127.0.0.1:9119' },
      }),
    )

    const res = await handler({ request: request() })
    const body = (await res.json()) as { ok: boolean; mode: string; reason: string }

    expect(res.status).toBe(503)
    expect(body.ok).toBe(false)
    expect(body.mode).toBe('agent-commands-unavailable')
    expect(body.reason).toBe('dashboard-unavailable')
    // The capability gate must short-circuit before any RPC is attempted.
    expect(getHermesCommandCatalog).not.toHaveBeenCalled()
  })

  it('distinguishes a reachable dashboard whose catalog RPC failed', async () => {
    vi.mocked(ensureGatewayProbed).mockResolvedValue(
      capabilities({ agentCommands: false }),
    )

    const res = await handler({ request: request() })
    const body = (await res.json()) as { reason: string }

    expect(res.status).toBe(503)
    expect(body.reason).toBe('commands-catalog-unavailable')
  })

  it('degrades in the same shape when the RPC fails after the probe passed', async () => {
    vi.mocked(getHermesCommandCatalog).mockRejectedValue(
      new Error('Hermes RPC timeout after 15000ms for commands.catalog'),
    )

    const res = await handler({ request: request() })
    const body = (await res.json()) as { ok: boolean; mode: string; reason: string }

    expect(res.status).toBe(503)
    expect(body.ok).toBe(false)
    expect(body.mode).toBe('agent-commands-unavailable')
    expect(body.reason).toMatch(/Hermes RPC timeout/)
  })
})
