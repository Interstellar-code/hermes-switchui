import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as HermesApi from '../../../server/hermes-api'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts as object,
}))

const auth = vi.hoisted(() => ({ isAuthenticated: vi.fn(() => true) }))

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: auth.isAuthenticated,
}))

const profileScope = vi.hoisted(() => ({
  isProfileScopeError: vi.fn(() => false),
  profileErrorStatus: vi.fn(() => 409),
}))

vi.mock('../../../server/profile-scope', () => ({
  isProfileScopeError: profileScope.isProfileScopeError,
  profileErrorStatus: profileScope.profileErrorStatus,
  readProfile: (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
}))

const hermes = vi.hoisted(() => ({
  getMessages: vi.fn(() =>
    Promise.resolve([] as Array<Record<string, unknown>>),
  ),
  ensureGatewayProbed: vi.fn(() => Promise.resolve({ sessions: true })),
  getGatewayCapabilities: vi.fn(() => ({ sessions: true })),
}))

// Only the network edge is mocked: `toChatMessage` and `extractToolEntries` are
// the real ones, so this exercises the real parse path.
vi.mock('../../../server/hermes-api', async () => {
  const actual = await vi.importActual<typeof HermesApi>(
    '../../../server/hermes-api',
  )
  return {
    ...actual,
    SESSIONS_API_UNAVAILABLE_MESSAGE: 'sessions unavailable',
    ensureGatewayProbed: hermes.ensureGatewayProbed,
    getGatewayCapabilities: hermes.getGatewayCapabilities,
    getMessages: hermes.getMessages,
  }
})

type Row = Record<string, unknown>

let rowSeq = 0

function assistant(toolCalls: Array<Row>): Row {
  rowSeq += 1
  return {
    id: rowSeq,
    session_id: 's1',
    role: 'assistant',
    content: '',
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      call_id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
    })),
    timestamp: 1_700_000_000 + rowSeq,
  }
}

function toolResult(callId: string, name: string, output: string): Row {
  rowSeq += 1
  return {
    id: rowSeq,
    session_id: 's1',
    role: 'tool',
    content: output,
    tool_call_id: callId,
    tool_name: name,
    timestamp: 1_700_000_000 + rowSeq,
  }
}

function user(text: string): Row {
  rowSeq += 1
  return {
    id: rowSeq,
    session_id: 's1',
    role: 'user',
    content: text,
    timestamp: 1_700_000_000 + rowSeq,
  }
}

async function get(sessionKey: string, query = '') {
  vi.resetModules()
  const route = (await import('./$sessionKey.tool-usage')).Route as unknown as {
    server: {
      handlers: {
        GET: (ctx: {
          request: Request
          params: { sessionKey: string }
        }) => Promise<Response>
      }
    }
  }
  return route.server.handlers.GET({
    request: new Request(
      `http://localhost/api/sessions/${sessionKey}/tool-usage${query ? `?${query}` : ''}`,
    ),
    params: { sessionKey },
  })
}

type Body = {
  ok: boolean
  error?: string
  entries: Array<{
    callId: string
    name: string
    args?: Record<string, unknown>
    output?: string
    isError: boolean
  }>
}

describe('GET /api/sessions/$sessionKey/tool-usage', () => {
  beforeEach(() => {
    rowSeq = 0
    hermes.getMessages.mockReset()
    hermes.getMessages.mockResolvedValue([])
    hermes.getGatewayCapabilities.mockReturnValue({ sessions: true })
    hermes.ensureGatewayProbed.mockClear()
    auth.isAuthenticated.mockReturnValue(true)
    profileScope.isProfileScopeError.mockReturnValue(false)
  })

  it('rejects an unauthenticated request', async () => {
    auth.isAuthenticated.mockReturnValue(false)
    const res = await get('s1')
    expect(res.status).toBe(401)
    expect(hermes.getMessages).not.toHaveBeenCalled()
  })

  it('503s when the gateway has no sessions capability', async () => {
    hermes.getGatewayCapabilities.mockReturnValue({ sessions: false })
    const res = await get('s1')
    expect(res.status).toBe(503)
    expect(hermes.getMessages).not.toHaveBeenCalled()
  })

  it('returns no entries for the draft session key "new" without hitting the gateway', async () => {
    const res = await get('new')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, entries: [] })
    expect(hermes.getMessages).not.toHaveBeenCalled()
  })

  it('finds skill and MCP calls beyond the 150-message loaded window', async () => {
    const rows: Array<Row> = [
      assistant([
        { id: 'call-skill', name: 'skill_view', args: { name: 'dataviz' } },
      ]),
      toolResult('call-skill', 'skill_view', '{"ok":true}'),
      assistant([
        {
          id: 'call-mcp',
          name: 'mcp_github_create_issue',
          args: { title: 'x' },
        },
      ]),
      toolResult('call-mcp', 'mcp_github_create_issue', '{"number":7}'),
      assistant([
        { id: 'call-term', name: 'terminal', args: { command: 'ls' } },
      ]),
      toolResult('call-term', 'terminal', '{"exit_code":0}'),
    ]
    // 300 filler messages AFTER the interesting ones: a newest-first 150-row
    // window would never contain any of them.
    for (let i = 0; i < 300; i += 1) rows.push(user(`filler ${i}`))
    hermes.getMessages.mockResolvedValue(rows)

    const res = await get('s1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Body
    expect(body.ok).toBe(true)
    expect(body.entries.map((e) => e.name)).toEqual([
      'skill_view',
      'mcp_github_create_issue',
    ])
    expect(body.entries[0].callId).toBe('call-skill')
    expect(body.entries[0].args).toEqual({ name: 'dataviz' })
    expect(body.entries[0].isError).toBe(false)
    expect(body.entries[1].callId).toBe('call-mcp')
  })

  it('includes the catalog listing and the MCP loader calls', async () => {
    hermes.getMessages.mockResolvedValue([
      assistant([{ id: 'c1', name: 'skills_list', args: {} }]),
      assistant([
        {
          id: 'c2',
          name: 'load_mcp_tools',
          args: { server_names: ['github'] },
        },
      ]),
      assistant([{ id: 'c3', name: 'skill', args: {} }]),
      toolResult('c3', 'skill', '"dataviz"'),
    ])
    const res = await get('s1')
    const body = (await res.json()) as Body
    expect(body.entries.map((e) => e.name)).toEqual([
      'skills_list',
      'load_mcp_tools',
      'skill',
    ])
  })

  it('marks a call failed when its tool result reports an error', async () => {
    hermes.getMessages.mockResolvedValue([
      assistant([
        { id: 'call-bad', name: 'skill_view', args: { name: 'nope' } },
      ]),
      toolResult('call-bad', 'skill_view', '{"error":"unknown skill"}'),
      assistant([{ id: 'call-ok', name: 'skill_view', args: { name: 'yes' } }]),
      toolResult('call-ok', 'skill_view', '{"ok":true}'),
    ])
    const res = await get('s1')
    const body = (await res.json()) as Body
    expect(body.entries).toHaveLength(2)
    expect(body.entries.find((e) => e.callId === 'call-bad')?.isError).toBe(
      true,
    )
    expect(body.entries.find((e) => e.callId === 'call-ok')?.isError).toBe(
      false,
    )
  })

  it('pages until a short page so the whole session is covered', async () => {
    const full = Array.from({ length: 500 }, (_, i) => user(`page-1 row ${i}`))
    const tail = [
      assistant([
        { id: 'call-tail', name: 'skill_manage', args: { action: 'delete' } },
      ]),
      toolResult('call-tail', 'skill_manage', '{"ok":true}'),
    ]
    hermes.getMessages
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce(tail)
      .mockResolvedValueOnce([])

    const res = await get('s1')
    const body = (await res.json()) as Body
    expect(hermes.getMessages).toHaveBeenCalledTimes(2)
    expect(body.entries.map((e) => e.callId)).toEqual(['call-tail'])
  })

  it('carries the result text for a plain skill call, and only for that tool', async () => {
    hermes.getMessages.mockResolvedValue([
      assistant([{ id: 'c-skill', name: 'skill', args: {} }]),
      toolResult('c-skill', 'skill', '"dataviz"'),
      assistant([
        { id: 'c-view', name: 'skill_view', args: { name: 'dataviz' } },
      ]),
      toolResult('c-view', 'skill_view', '{"ok":true}'),
      assistant([
        { id: 'c-mcp', name: 'mcp__github__search', args: { q: 'x' } },
      ]),
      toolResult('c-mcp', 'mcp__github__search', 'a very long result body'),
    ])
    const res = await get('s1')
    const body = (await res.json()) as Body
    const byId = new Map(body.entries.map((e) => [e.callId, e]))
    expect(byId.get('c-skill')?.output).toBe('"dataviz"')
    expect(byId.get('c-view')?.output).toBeUndefined()
    expect(byId.get('c-mcp')?.output).toBeUndefined()
  })

  it('caps the skill result text at 200 chars', async () => {
    const long = `"${'n'.repeat(400)}"`
    hermes.getMessages.mockResolvedValue([
      assistant([{ id: 'c-long', name: 'skill', args: {} }]),
      toolResult('c-long', 'skill', long),
    ])
    const res = await get('s1')
    const body = (await res.json()) as Body
    expect(body.entries[0].output).toHaveLength(200)
  })

  it('omits output when a skill call has no result row', async () => {
    hermes.getMessages.mockResolvedValue([
      assistant([{ id: 'c-none', name: 'skill', args: {} }]),
    ])
    const res = await get('s1')
    const body = (await res.json()) as Body
    expect(body.entries[0].output).toBeUndefined()
  })

  it('stops paging when a backend ignores offset', async () => {
    const stuck = [
      assistant([{ id: 'c-stuck', name: 'skill_view', args: { name: 'a' } }]),
      toolResult('c-stuck', 'skill_view', '{"ok":true}'),
      ...Array.from({ length: 498 }, (_, i) => user(`stuck row ${i}`)),
    ]
    // Every offset returns the identical full page — 40 calls, same window.
    hermes.getMessages.mockResolvedValue(stuck)

    const res = await get('s1')
    const body = (await res.json()) as Body
    expect(hermes.getMessages.mock.calls.length).toBeLessThanOrEqual(2)
    expect(body.entries.map((e) => e.callId)).toEqual(['c-stuck'])
  })

  it('passes the profile through and maps a profile-scope error', async () => {
    hermes.getMessages.mockResolvedValue([user('hi')])
    await get('s1', 'profile=neo')
    expect(hermes.getMessages).toHaveBeenCalledWith(
      's1',
      { limit: 500, offset: 0, order: 'latest' },
      'neo',
    )

    profileScope.isProfileScopeError.mockReturnValue(true)
    hermes.getMessages.mockRejectedValueOnce(
      new Error('Profile neo unavailable'),
    )
    const res = await get('s1', 'profile=neo')
    expect(res.status).toBe(409)
    const body = (await res.json()) as { ok: boolean; profile: string }
    expect(body.ok).toBe(false)
    expect(body.profile).toBe('neo')
  })
})
