import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { ensureGatewayProbed } from '../../server/gateway-capabilities'
import {
  catalogPolicyInputs,
  getHermesCommandCatalog,
} from '../../server/hermes-commands'
import { runSlashCommand } from '../../server/hermes-slash-exec'
import { Route } from './hermes-commands.exec'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/gateway-capabilities', () => ({
  CLAUDE_DASHBOARD_URL: 'http://127.0.0.1:9119',
  ensureGatewayProbed: vi.fn(),
}))

vi.mock('../../server/hermes-commands', () => ({
  getHermesCommandCatalog: vi.fn(),
  catalogPolicyInputs: vi.fn(),
}))

vi.mock('../../server/hermes-slash-exec', () => ({
  runSlashCommand: vi.fn(),
}))

type RouteWithHandlers = typeof Route & {
  options: {
    server: {
      handlers: { POST: (ctx: { request: Request }) => Promise<Response> }
    }
  }
}

const handler = (Route as RouteWithHandlers).options.server.handlers.POST

function request(body: unknown) {
  return new Request('http://x/api/hermes-commands/exec', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const capabilities = (overrides: Record<string, unknown> = {}) =>
  ({
    agentCommands: true,
    dashboard: { available: true, url: 'http://127.0.0.1:9119' },
    ...overrides,
  }) as never

describe('POST /api/hermes-commands/exec', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(ensureGatewayProbed).mockResolvedValue(capabilities())
    vi.mocked(getHermesCommandCatalog).mockResolvedValue({
      commands: [],
      categories: [],
      aliases: {},
      skillCount: 0,
      bundleCount: 0,
      warning: '',
    })
    vi.mocked(catalogPolicyInputs).mockReturnValue({
      aliases: { '/compact': '/compress' },
      skillCommands: new Set(['/arxiv']),
      bundleCommands: new Set(['/research-stack']),
    })
    vi.mocked(runSlashCommand).mockResolvedValue({
      ok: true,
      command: '/status',
      result: { type: 'exec', output: 'Hermes TUI Status' },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)
    const response = await handler({ request: request({ command: '/status' }) })
    expect(response.status).toBe(401)
    expect(runSlashCommand).not.toHaveBeenCalled()
  })

  it('rejects a request without the JSON content type (CSRF)', async () => {
    const response = await handler({
      request: new Request('http://x/api/hermes-commands/exec', {
        method: 'POST',
        body: 'command=/status',
      }),
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(runSlashCommand).not.toHaveBeenCalled()
  })

  it('rejects a body that is not a slash command', async () => {
    for (const body of [{}, { command: 'status' }, { command: '' }]) {
      const response = await handler({ request: request(body) })
      expect(response.status).toBe(400)
    }
    expect(runSlashCommand).not.toHaveBeenCalled()
  })

  it('answers 503 when the agentCommands capability is off', async () => {
    vi.mocked(ensureGatewayProbed).mockResolvedValue(
      capabilities({ agentCommands: false }),
    )
    const response = await handler({ request: request({ command: '/status' }) })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      mode: 'agent-commands-unavailable',
      reason: 'commands-catalog-unavailable',
    })
    expect(runSlashCommand).not.toHaveBeenCalled()
  })

  it('runs an allowed command and returns the union', async () => {
    const response = await handler({
      request: request({ command: '/status', sessionId: 'chat-1' }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      command: '/status',
      result: { type: 'exec', output: 'Hermes TUI Status' },
    })
    expect(runSlashCommand).toHaveBeenCalledWith('/status', {
      chatSessionId: 'chat-1',
      aliases: { '/compact': '/compress' },
      skillCommands: new Set(['/arxiv']),
      // Forwarded alongside the skills, from the same catalog read. Without
      // this the policy would refuse every bundle slug as "not on the
      // allowlist" — the exact refusal `/bundles` was held back to avoid.
      bundleCommands: new Set(['/research-stack']),
    })
  })

  it('answers 403 with the reason when the allowlist refuses', async () => {
    vi.mocked(runSlashCommand).mockResolvedValue({
      ok: false,
      refused: true,
      command: '/yolo',
      reason: '/yolo would report that approvals are bypassed…',
    })
    const response = await handler({ request: request({ command: '/yolo' }) })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      refused: true,
      reason: expect.stringContaining('/yolo'),
    })
  })

  it('still enforces the allowlist when the catalog lookup fails', async () => {
    // A catalog failure must not become an open door: the route runs without
    // aliases/skills/bundles rather than skipping the policy. Skills and
    // bundles both go dark together — they come from the same read — which
    // costs their dispatch and is the safe direction.
    vi.mocked(getHermesCommandCatalog).mockRejectedValue(new Error('no dash'))
    await handler({ request: request({ command: '/status' }) })
    expect(runSlashCommand).toHaveBeenCalledWith('/status', {
      chatSessionId: null,
      aliases: undefined,
      skillCommands: undefined,
      bundleCommands: undefined,
    })
  })

  it('maps a timeout to 504 with an explanation, not a hang', async () => {
    vi.mocked(runSlashCommand).mockRejectedValue(
      new Error('Hermes RPC timeout after 30000ms for slash.exec'),
    )
    const response = await handler({ request: request({ command: '/tools' }) })
    expect(response.status).toBe(504)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('did not answer in time'),
    })
  })

  it('maps any other agent failure to 502', async () => {
    vi.mocked(runSlashCommand).mockRejectedValue(new Error('socket closed'))
    const response = await handler({ request: request({ command: '/status' }) })
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'socket closed',
    })
  })
})
