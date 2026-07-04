import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { dashboardFetch, ensureGatewayProbed } from '../../server/gateway-capabilities'
import { Route } from './logs'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/gateway-capabilities', () => ({
  dashboardFetch: vi.fn(),
  ensureGatewayProbed: vi.fn(),
}))

const mockWorkspaceHome = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix3d-logs-'))

vi.mock('../../server/claude-paths', () => ({
  getProfileClaudeHome: (profile: string) => path.join(mockWorkspaceHome, 'profiles', profile),
  getWorkspaceClaudeHome: () => mockWorkspaceHome,
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

describe('GET /api/logs', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)

    const res = await handler({
      request: new Request('http://localhost/api/logs?file=agent&lines=20'),
    })

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ ok: false })
  })

  it('returns 503 when gateway is unavailable', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(ensureGatewayProbed).mockResolvedValue({
      health: false,
      chatCompletions: false,
    } as Awaited<ReturnType<typeof ensureGatewayProbed>>)

    const res = await handler({
      request: new Request('http://localhost/api/logs?file=gateway'),
    })

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/unavailable/i),
    })
  })

  it('falls back to local log files when dashboard logs endpoint is missing', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(ensureGatewayProbed).mockResolvedValue({
      health: true,
      chatCompletions: true,
    } as Awaited<ReturnType<typeof ensureGatewayProbed>>)

    fs.mkdirSync(path.join(mockWorkspaceHome, 'logs'), { recursive: true })
    fs.writeFileSync(
      path.join(mockWorkspaceHome, 'logs', 'agent.log'),
      ['line-1', 'line-2', 'line-3'].join('\n'),
      'utf8',
    )

    vi.mocked(dashboardFetch).mockResolvedValue(
      new Response('404: Not Found', {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await handler({
      request: new Request(
        'http://localhost/api/logs?file=agent&lines=25&level=warn&component=matrix3d',
      ),
    })

    expect(dashboardFetch).toHaveBeenCalledWith(
      '/api/logs?lines=25&file=agent&level=warn&component=matrix3d',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      file: 'agent',
      source: 'local-fallback',
      path: path.join(mockWorkspaceHome, 'logs', 'agent.log'),
      mtimeMs: expect.any(Number),
      lines: ['line-1', 'line-2', 'line-3'],
    })
  })

  it('uses the freshest local profile log instead of stale workspace logs', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(ensureGatewayProbed).mockResolvedValue({
      health: true,
      chatCompletions: true,
    } as Awaited<ReturnType<typeof ensureGatewayProbed>>)

    const workspaceLog = path.join(mockWorkspaceHome, 'logs', 'gateway.log')
    const profileLog = path.join(
      mockWorkspaceHome,
      'profiles',
      'hermes-switch',
      'logs',
      'gateway.log',
    )
    fs.mkdirSync(path.dirname(workspaceLog), { recursive: true })
    fs.mkdirSync(path.dirname(profileLog), { recursive: true })
    fs.writeFileSync(workspaceLog, 'stale-workspace-line', 'utf8')
    fs.writeFileSync(profileLog, 'fresh-profile-line', 'utf8')
    const stale = new Date('2026-05-27T12:00:00Z')
    const fresh = new Date('2026-05-28T12:00:00Z')
    fs.utimesSync(workspaceLog, stale, stale)
    fs.utimesSync(profileLog, fresh, fresh)

    vi.mocked(dashboardFetch).mockResolvedValue(new Response('404: Not Found', { status: 404 }))

    const res = await handler({
      request: new Request('http://localhost/api/logs?file=gateway&lines=25'),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      file: 'gateway',
      source: 'local-fallback',
      path: profileLog,
      lines: ['fresh-profile-line'],
    })
  })
})
