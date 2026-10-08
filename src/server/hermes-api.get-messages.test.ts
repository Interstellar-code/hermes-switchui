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

describe('toChatMessage persisted reasoning', () => {
  const assistantRow = {
    id: 1,
    session_id: 's',
    role: 'assistant',
    content: 'the answer',
    timestamp: 10,
  }

  const contentOf = (msg: Record<string, unknown>) =>
    msg.content as Array<Record<string, unknown>>

  it('maps reasoning to a leading thinking part', () => {
    const out = toChatMessage({ ...assistantRow, reasoning: 'x' })
    expect(contentOf(out)[0]).toEqual({ type: 'thinking', thinking: 'x' })
    expect(contentOf(out)[1]).toEqual({ type: 'text', text: 'the answer' })
  })

  it('maps the reasoning_content alias the same way', () => {
    const out = toChatMessage({ ...assistantRow, reasoning_content: 'x' })
    expect(contentOf(out)[0]).toEqual({ type: 'thinking', thinking: 'x' })
  })

  it('prefers reasoning over reasoning_content', () => {
    const out = toChatMessage({
      ...assistantRow,
      reasoning: 'canonical',
      reasoning_content: 'alias',
    })
    expect(contentOf(out)[0]).toEqual({
      type: 'thinking',
      thinking: 'canonical',
    })
  })

  it('adds no thinking part without usable reasoning', () => {
    for (const row of [
      assistantRow,
      { ...assistantRow, reasoning: null, reasoning_content: null },
      { ...assistantRow, reasoning: '' },
      { ...assistantRow, reasoning_content: '' },
    ]) {
      const out = toChatMessage(row)
      expect(contentOf(out).some((part) => part.type === 'thinking')).toBe(
        false,
      )
    }
  })

  it('places the thinking part ahead of tool calls and text', () => {
    const out = toChatMessage({
      ...assistantRow,
      reasoning: 'thought it through',
      tool_calls: [
        {
          id: 'toolu_1',
          function: { name: 'read_file', arguments: '{"path":"/tmp"}' },
        },
      ],
    })
    expect(contentOf(out)[0]).toEqual({
      type: 'thinking',
      thinking: 'thought it through',
    })
    expect(String(contentOf(out)[1]?.type)).toBe('toolCall')
    expect(String(contentOf(out)[2]?.type)).toBe('text')
  })

  it('ignores reasoning on non-assistant rows', () => {
    const out = toChatMessage({
      ...assistantRow,
      role: 'user',
      reasoning: 'users do not reason',
    })
    expect(contentOf(out).some((part) => part.type === 'thinking')).toBe(false)
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
