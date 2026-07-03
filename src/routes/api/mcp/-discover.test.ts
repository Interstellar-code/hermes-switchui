/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))
vi.mock('../../../server/rate-limit', () => ({
  requireJsonContentType: vi.fn(),
  safeErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}))
vi.mock('../../../server/gateway-capabilities', () => ({
  ensureGatewayProbed: vi.fn(),
  getCapabilities: vi.fn(),
  BEARER_TOKEN: '',
  CLAUDE_API: 'http://127.0.0.1:8642',
  CLAUDE_UPGRADE_INSTRUCTIONS: 'noop',
  dashboardFetch: vi.fn(),
}))
vi.mock('../../../server/mcp-cli-bridge', () => ({
  runHermesMcpTest: vi.fn(),
}))
vi.mock('../../../server/mcp-tools-cache', () => ({
  setProbe: vi.fn(),
}))

import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { ensureGatewayProbed } from '../../../server/gateway-capabilities'
import { runHermesMcpTest } from '../../../server/mcp-cli-bridge'
import { setProbe } from '../../../server/mcp-tools-cache'
import { Route } from './discover'

const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockRequireJsonContentType = vi.mocked(requireJsonContentType)
const mockEnsureGatewayProbed = vi.mocked(ensureGatewayProbed)
const mockRunHermesMcpTest = vi.mocked(runHermesMcpTest)
const mockSetProbe = vi.mocked(setProbe)

type ServerHandlers = { POST: (ctx: { request: Request }) => Promise<Response> }

async function callPost(body: unknown): Promise<Response> {
  const handlers = Route.options.server?.handlers as unknown as ServerHandlers | undefined
  const handler = handlers?.POST
  if (!handler) throw new Error('No POST handler')
  return handler({
    request: new Request('http://localhost/api/mcp/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mockIsAuthenticated.mockReturnValue(true)
  mockRequireJsonContentType.mockReturnValue(null)
})

describe('POST /api/mcp/discover fallback mode', () => {
  it('reuses hermes mcp test for saved server names and returns discovered tools', async () => {
    mockEnsureGatewayProbed.mockResolvedValue({ mcp: false, mcpFallback: true } as never)
    mockRunHermesMcpTest.mockResolvedValue({
      ok: true,
      status: 'connected',
      latencyMs: 42,
      discoveredTools: [{ name: 'search', description: 'Search docs' }],
      error: null,
    })

    const res = await callPost({ name: 'trek' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.tools).toEqual([{ name: 'search', description: 'Search docs' }])
    expect(mockRunHermesMcpTest).toHaveBeenCalledWith('trek', { timeoutMs: 30000 })
    expect(mockSetProbe).toHaveBeenCalledWith('trek', expect.objectContaining({
      toolCount: 1,
      toolNames: ['search'],
      latencyMs: 42,
    }))
  })

  it('returns 400 when fallback discover lacks a saved server name', async () => {
    mockEnsureGatewayProbed.mockResolvedValue({ mcp: false, mcpFallback: true } as never)

    const res = await callPost({ transportType: 'stdio' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/saved servers by name/i)
  })
})
