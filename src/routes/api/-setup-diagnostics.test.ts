/**
 * The endpoint's contract is narrow but absolute: auth-gate, then never
 * throw. A diagnostics endpoint that 500s exactly when things are broken is
 * worthless, so the failure paths matter more than the happy one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { runSetupDiagnostics } from '../../server/setup-diagnostics'
import { Route } from './setup-diagnostics'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/setup-diagnostics', () => ({
  runSetupDiagnostics: vi.fn(),
}))

type RouteWithHandlers = typeof Route & {
  options: {
    server: {
      handlers: { GET: (ctx: { request: Request }) => Promise<Response> }
    }
  }
}

const handler = (Route as RouteWithHandlers).options.server.handlers.GET
const request = () => new Request('http://x/api/setup-diagnostics')

const healthy = {
  generatedAt: '2026-08-10T00:00:00.000Z',
  gatewayUrl: 'http://127.0.0.1:8642',
  dashboardUrl: 'http://127.0.0.1:9119',
  severity: 'ok' as const,
  gatewayProcessRunning: true,
  missingCapabilities: [],
  firstRun: false,
  findings: [
    { id: 'gateway-reachability', severity: 'ok' as const, title: 'fine' },
  ],
}

describe('GET /api/setup-diagnostics', () => {
  beforeEach(() => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(runSetupDiagnostics).mockResolvedValue(healthy)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)
    const res = await handler({ request: request() })
    expect(res.status).toBe(401)
    expect(runSetupDiagnostics).not.toHaveBeenCalled()
  })

  it('fails closed with 401 when the auth check itself throws', async () => {
    vi.mocked(isAuthenticated).mockImplementation(() => {
      throw new Error('session store unavailable')
    })
    const res = await handler({ request: request() })
    expect(res.status).toBe(401)
    expect(runSetupDiagnostics).not.toHaveBeenCalled()
  })

  it('returns the diagnostics payload verbatim', async () => {
    const res = await handler({ request: request() })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(healthy)
  })

  it('never throws when the diagnosis itself fails — returns a degraded 200', async () => {
    vi.mocked(runSetupDiagnostics).mockRejectedValue(
      new Error('everything is on fire'),
    )

    const res = await handler({ request: request() })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      severity: string
      gatewayProcessRunning: boolean | null
      firstRun: boolean
      findings: Array<{ id: string; severity: string; detail?: string }>
    }
    expect(body.severity).toBe('unknown')
    // Not `false`: a crashed diagnosis must not claim "nothing is running" and
    // put the useless Auto-Start button back on the screen.
    expect(body.gatewayProcessRunning).toBeNull()
    // Not `true` either: a crashed diagnosis must not greet an existing user
    // as brand new.
    expect(body.firstRun).toBe(false)
    expect(body.findings[0].id).toBe('diagnostics-unavailable')
    expect(body.findings[0].detail).toContain('everything is on fire')
  })

  it('survives a non-Error rejection', async () => {
    vi.mocked(runSetupDiagnostics).mockRejectedValue('a bare string')
    const res = await handler({ request: request() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { findings: Array<{ detail?: string }> }
    expect(body.findings[0].detail).toContain('a bare string')
  })

  it('never leaks a secret-shaped value from the underlying report', async () => {
    vi.mocked(runSetupDiagnostics).mockResolvedValue({
      ...healthy,
      findings: [
        {
          id: 'gateway-token',
          severity: 'error',
          title: 'keys differ',
          data: { workspaceTokenFingerprint: 'abc123def456' },
        },
      ],
    })
    const res = await handler({ request: request() })
    const text = await res.text()
    expect(text).toContain('abc123def456')
    expect(text).not.toContain('API_SERVER_KEY=')
  })
})
