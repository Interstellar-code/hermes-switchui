import { describe, expect, it, vi } from 'vitest'

import { listSessions as listDashboardSessions } from './claude-dashboard-api'
import { listSessions } from './hermes-api'

vi.mock('./gateway-capabilities', () => ({
  BEARER_TOKEN: 'test-token',
  CLAUDE_API: 'http://127.0.0.1:8642',
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'unavailable',
  dashboardFetch: vi.fn(),
  ensureGatewayProbed: vi.fn(),
  getCapabilities: vi.fn(() => ({
    dashboard: { available: true },
  })),
  probeGateway: vi.fn(),
}))

vi.mock('./claude-dashboard-api', () => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  forkSession: vi.fn(),
  getSession: vi.fn(),
  getSessionMessages: vi.fn(),
  listSessions: vi.fn(),
  searchSessions: vi.fn(),
  updateSession: vi.fn(),
}))

describe('listSessions (dashboard)', () => {
  it('pages in chunks of 100 because hermes-agent 0.21.3 rejects limit>100', async () => {
    const total = 250
    vi.mocked(listDashboardSessions).mockImplementation(
      async (limit = 50, offset = 0) => {
        expect(limit).toBeLessThanOrEqual(100)
        const count = Math.max(0, Math.min(limit, total - offset))
        return {
          sessions: Array.from({ length: count }, (_, i) => ({
            id: `s${offset + i}`,
          })),
          total,
          limit,
          offset,
        }
      },
    )

    const rows = await listSessions(1000, 0)

    expect(rows).toHaveLength(total)
    expect(rows[249]?.id).toBe('s249')
    expect(listDashboardSessions).toHaveBeenCalledTimes(3)
  })
})
