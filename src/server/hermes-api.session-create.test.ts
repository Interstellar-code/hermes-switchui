import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./gateway-capabilities', () => ({
  BEARER_TOKEN: 'test-token',
  CLAUDE_API: 'http://127.0.0.1:8642',
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'unavailable',
  dashboardFetch: vi.fn(),
  ensureGatewayProbed: vi.fn(),
  getCapabilities: vi.fn(() => ({
    dashboard: { available: true },
    enhancedChat: true,
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

import { createSession as createDashboardSession } from './claude-dashboard-api'
import { createSession } from './hermes-api'

describe('createSession', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(createDashboardSession).mockReset()
  })

  it('uses the gateway sessions API when enhanced chat is enabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        session: {
          id: 'session-1',
          title: 'hello',
          started_at: 1,
          last_active: 1,
        },
      }),
    )

    const session = await createSession({ id: 'friendly-1', title: 'hello' })

    expect(createDashboardSession).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:8642/api/sessions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      }),
    )
    expect(session.id).toBe('session-1')
  })
})
