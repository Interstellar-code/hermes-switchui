import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { Route } from './logs'
import { ensureGatewayProbed } from '../../server/gateway-capabilities'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/gateway-capabilities', () => ({
  BEARER_TOKEN: 'test-token',
  CLAUDE_API: 'http://127.0.0.1:8642',
  ensureGatewayProbed: vi.fn(),
}))

const mockWorkspaceHome = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix3d-logs-'))

vi.mock('../../server/claude-paths', () => ({
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

  it('falls back to local log files when upstream logs endpoint is missing', async () => {
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

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
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

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8642/api/logs?lines=25&file=agent&level=warn&component=matrix3d',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      }),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      file: 'agent',
      source: 'local-fallback',
      path: path.join(mockWorkspaceHome, 'logs', 'agent.log'),
      lines: ['line-1', 'line-2', 'line-3'],
    })
  })
})
