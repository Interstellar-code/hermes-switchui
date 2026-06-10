import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/rate-limit', () => ({
  requireJsonContentType: vi.fn(),
}))

vi.mock('../../server/gateway-capabilities', () => ({
  BEARER_TOKEN: '',
  CLAUDE_API: 'http://gateway.test',
  CLAUDE_UPGRADE_INSTRUCTIONS: 'upgrade required',
  dashboardFetch: vi.fn(),
  ensureGatewayProbed: vi.fn(),
}))

vi.mock('../../server/hermes-api', () => ({
  deleteSession: vi.fn(),
}))

import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  dashboardFetch,
  ensureGatewayProbed,
} from '../../server/gateway-capabilities'
import { deleteSession } from '../../server/hermes-api'
import { Route } from './claude-jobs.$jobId'

const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockRequireJsonContentType = vi.mocked(requireJsonContentType)
const mockDashboardFetch = vi.mocked(dashboardFetch)
const mockEnsureGatewayProbed = vi.mocked(ensureGatewayProbed)
const mockDeleteSession = vi.mocked(deleteSession)

type GetHandler = (ctx: {
  request: Request
  params: { jobId: string }
}) => Promise<Response>

type DeleteHandler = (ctx: {
  request: Request
  params: { jobId: string }
}) => Promise<Response>

const handlers = (
  Route.options as {
    server: { handlers: { GET: GetHandler; DELETE: DeleteHandler } }
  }
).server.handlers

describe('/api/claude-jobs/:jobId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
    mockEnsureGatewayProbed.mockResolvedValue({
      jobs: true,
      sessions: true,
      dashboard: { available: true },
    } as Awaited<ReturnType<typeof ensureGatewayProbed>>)
    mockDashboardFetch.mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    mockDeleteSession.mockResolvedValue(undefined)
  })

  it('proxies run history to dashboard runs and preserves the limit query', async () => {
    const request = new Request(
      'http://localhost/api/claude-jobs/nightly?action=runs&limit=20',
    )

    const response = await handlers.GET({
      request,
      params: { jobId: 'nightly' },
    })

    expect(response.status).toBe(200)
    expect(mockDashboardFetch).toHaveBeenCalledWith(
      '/api/cron/jobs/nightly/runs?limit=20',
    )
  })

  it('keeps the legacy output action as an alias for run history', async () => {
    const request = new Request(
      'http://localhost/api/claude-jobs/nightly?action=output&limit=10',
    )

    await handlers.GET({ request, params: { jobId: 'nightly' } })

    expect(mockDashboardFetch).toHaveBeenCalledWith(
      '/api/cron/jobs/nightly/runs?limit=10',
    )
  })

  it('falls back to job detail when the dashboard has no dedicated runs endpoint', async () => {
    mockDashboardFetch.mockImplementation(async (path) => {
      if (path === '/api/cron/jobs/nightly/runs?limit=10') {
        return new Response(
          JSON.stringify({
            detail: 'No such API endpoint: /api/cron/jobs/nightly/runs',
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (path === '/api/cron/jobs/nightly') {
        return new Response(
          JSON.stringify({
            id: 'nightly',
            last_run_at: '2026-06-09T09:03:41.114606+02:00',
            last_status: 'ok',
            last_error: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      throw new Error(`unexpected dashboardFetch ${path}`)
    })

    const request = new Request(
      'http://localhost/api/claude-jobs/nightly?action=runs&limit=10',
    )

    const response = await handlers.GET({
      request,
      params: { jobId: 'nightly' },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.runs).toEqual([
      {
        id: 'last-run-2026-06-09T09:03:41.114606+02:00',
        status: 'ok',
        startedAt: '2026-06-09T09:03:41.114606+02:00',
      },
    ])
  })

  it('proxies a bodyless cron delete without requiring a JSON content type', async () => {
    const request = new Request('http://localhost/api/claude-jobs/nightly', {
      method: 'DELETE',
    })

    const response = await handlers.DELETE({
      request,
      params: { jobId: 'nightly' },
    })

    expect(response.status).toBe(200)
    expect(mockRequireJsonContentType).not.toHaveBeenCalled()
    expect(mockDashboardFetch).toHaveBeenCalledWith('/api/cron/jobs/nightly', {
      method: 'DELETE',
    })
  })

  it('deletes chat sessions linked from cron run history when deleting the cron', async () => {
    mockDashboardFetch.mockImplementation(async (path, init) => {
      if (path === '/api/cron/jobs/nightly/runs?limit=100') {
        return new Response(
          JSON.stringify({
            runs: [
              { id: 'run-1', chatSessionKey: 'cron_chat_1' },
              { id: 'run-2', output: { friendlyId: 'cron_chat_2' } },
              { id: 'run-3', context: { sessionId: 'cron_chat_1' } },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (path === '/api/cron/jobs/nightly' && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected dashboardFetch ${path}`)
    })

    const request = new Request('http://localhost/api/claude-jobs/nightly', {
      method: 'DELETE',
    })

    const response = await handlers.DELETE({
      request,
      params: { jobId: 'nightly' },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockDeleteSession).toHaveBeenCalledTimes(2)
    expect(mockDeleteSession).toHaveBeenNthCalledWith(1, 'cron_chat_1')
    expect(mockDeleteSession).toHaveBeenNthCalledWith(2, 'cron_chat_2')
    expect(body.sessionCleanup).toEqual({
      deleted: ['cron_chat_1', 'cron_chat_2'],
      failed: [],
    })
  })
})
