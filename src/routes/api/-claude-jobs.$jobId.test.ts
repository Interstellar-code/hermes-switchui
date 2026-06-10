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

import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  dashboardFetch,
  ensureGatewayProbed,
} from '../../server/gateway-capabilities'
import { Route } from './claude-jobs.$jobId'

const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockRequireJsonContentType = vi.mocked(requireJsonContentType)
const mockDashboardFetch = vi.mocked(dashboardFetch)
const mockEnsureGatewayProbed = vi.mocked(ensureGatewayProbed)

type DeleteHandler = (ctx: {
  request: Request
  params: { jobId: string }
}) => Promise<Response>

const deleteHandler = (
  Route.options as {
    server: { handlers: { DELETE: DeleteHandler } }
  }
).server.handlers.DELETE

describe('DELETE /api/claude-jobs/:jobId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
    mockEnsureGatewayProbed.mockResolvedValue({
      jobs: true,
      dashboard: { available: true },
    } as Awaited<ReturnType<typeof ensureGatewayProbed>>)
    mockDashboardFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  it('proxies a bodyless cron delete without requiring a JSON content type', async () => {
    const request = new Request('http://localhost/api/claude-jobs/nightly', {
      method: 'DELETE',
    })

    const response = await deleteHandler({
      request,
      params: { jobId: 'nightly' },
    })

    expect(response.status).toBe(200)
    expect(mockRequireJsonContentType).not.toHaveBeenCalled()
    expect(mockDashboardFetch).toHaveBeenCalledWith('/api/cron/jobs/nightly', {
      method: 'DELETE',
    })
  })
})
