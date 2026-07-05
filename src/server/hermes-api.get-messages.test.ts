import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSessionMessages } from './claude-dashboard-api'
import { getMessages } from './hermes-api'

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

describe('getMessages', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(getSessionMessages).mockReset()
  })

  it('bypasses the dashboard path when tail pagination is requested', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        object: 'list',
        session_id: 'session-1',
        data: [{ id: 2, session_id: 'session-1', role: 'assistant', content: 'ok', timestamp: 2 }],
      }),
    )

    const rows = await getMessages('session-1', { limit: 1, offset: 0 })

    expect(getSessionMessages).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:8642/api/sessions/session-1/messages?limit=1&offset=0',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(2)
  })
})
