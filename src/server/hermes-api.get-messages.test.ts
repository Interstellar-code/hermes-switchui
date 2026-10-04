import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSessionMessages } from './claude-dashboard-api'
import { getMessages, toChatMessage } from './hermes-api'

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

  it('uses dashboard pagination when tail retrieval is requested', async () => {
    vi.mocked(getSessionMessages).mockResolvedValue({
      messages: [
        {
          id: 2,
          session_id: 'session-1',
          role: 'assistant',
          content: 'ok',
          timestamp: 2,
        },
      ],
    })

    const rows = await getMessages('session-1', { limit: 1, offset: 0 })

    expect(getSessionMessages).toHaveBeenCalledWith('session-1', {
      limit: 1,
      offset: 0,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(2)
  })

  it('forwards order=latest (hermes defaults a limited fetch to oldest)', async () => {
    vi.mocked(getSessionMessages).mockResolvedValue({ messages: [] })
    await getMessages('session-1', { limit: 150, offset: 0, order: 'latest' })
    expect(getSessionMessages).toHaveBeenCalledWith('session-1', {
      limit: 150,
      offset: 0,
      order: 'latest',
    })
  })
})

describe('toChatMessage display_kind passthrough', () => {
  const row = {
    id: 156236,
    session_id: 's',
    role: 'user',
    content: '[ASYNC DELEGATION BATCH COMPLETE — deleg_ecb902b2]',
    timestamp: 10,
  }

  it('passes display_kind through as displayKind', () => {
    const out = toChatMessage({
      ...row,
      display_kind: 'async_delegation_complete',
    })
    expect(out.displayKind).toBe('async_delegation_complete')
    expect(out).not.toHaveProperty('displayMetadata')
  })

  it('passes display_metadata as an object, parsing raw JSON strings', () => {
    const meta = { delegation_id: 'deleg_x', task_count: 3 }
    expect(
      toChatMessage({ ...row, display_metadata: meta }).displayMetadata,
    ).toEqual(meta)
    expect(
      toChatMessage({ ...row, display_metadata: JSON.stringify(meta) })
        .displayMetadata,
    ).toEqual(meta)
    expect(
      toChatMessage({ ...row, display_metadata: 'not json' }),
    ).not.toHaveProperty('displayMetadata')
  })

  it('omits both for ordinary rows', () => {
    const out = toChatMessage({ ...row, display_kind: null })
    expect(out).not.toHaveProperty('displayKind')
    expect(out).not.toHaveProperty('displayMetadata')
  })
})
