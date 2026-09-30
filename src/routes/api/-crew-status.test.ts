import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { ensureGatewayProbed } from '../../server/gateway-capabilities'
import { getKanbanBoard } from '../../server/hermes-kanban-client'
import { Route } from './crew-status'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/gateway-capabilities', () => ({
  ensureGatewayProbed: vi.fn(),
}))

vi.mock('../../server/hermes-kanban-client', () => ({
  getKanbanBoard: vi.fn(),
}))

const paths = vi.hoisted(() => ({ root: '/tmp/missing-root' }))

vi.mock('../../server/claude-paths', () => ({
  getClaudeRoot: () => paths.root,
  getProfileClaudeHome: (profile: string) =>
    `${paths.root}/profiles/${profile}`,
  getWorkspaceClaudeHome: () => paths.root,
}))

/** Minimal state.db: one live terminal-running session + one older session. */
function seedProfileDb(dbPath: string, command = 'pnpm test') {
  const script = `
import json, sqlite3, sys, time
c = sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, parent_session_id TEXT, title TEXT, started_at REAL, ended_at REAL, message_count INT, tool_call_count INT, input_tokens INT, output_tokens INT, estimated_cost_usd REAL, last_activity_at REAL, last_activity_description TEXT)")
c.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT, timestamp REAL)")
now = time.time()
c.execute("INSERT INTO sessions VALUES ('old', 'cli', NULL, 'Old', ?, ?, 1, 0, 0, 0, NULL, ?, NULL)", (now - 900, now - 800, now - 800))
c.execute("INSERT INTO sessions VALUES ('live', 'telegram', NULL, 'Run tests', ?, NULL, 3, 1, 0, 0, NULL, ?, 'terminal command running (111s elapsed)')", (now - 200, now - 5))
c.execute("INSERT INTO sessions VALUES ('cron-1', 'cron', NULL, 'Cron', ?, NULL, 1, 0, 0, 0, NULL, NULL, NULL)", (now - 60,))
c.execute("INSERT INTO messages (session_id, role, content, tool_calls, timestamp) VALUES ('cron-1', 'user', 'tick', NULL, ?)", (now - 50,))
c.execute("INSERT INTO messages (session_id, role, content, tool_calls, timestamp) VALUES ('live', 'user', 'please run the tests', NULL, ?)", (now - 120,))
command = sys.argv[2]
calls = [{"id": "c1", "type": "function", "function": {"name": "terminal", "arguments": json.dumps({"command": command, "timeout": 300})}}]
c.execute("INSERT INTO messages (session_id, role, content, tool_calls, timestamp) VALUES ('live', 'assistant', '', ?, ?)", (json.dumps(calls), now - 10))
c.commit()
`
  execFileSync('python3', ['-c', script, dbPath, command])
}

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

describe('GET /api/crew-status', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(ensureGatewayProbed).mockResolvedValue({} as never)
    vi.mocked(getKanbanBoard).mockResolvedValue({
      columns: [
        {
          name: 'todo',
          tasks: [
            { assignee: 'workspace' },
            { assignee: 'workspace' },
            { assignee: 'ghost' },
            { assignee: null },
          ],
        },
        {
          name: 'done',
          tasks: [{ assignee: 'workspace' }],
        },
        {
          name: 'archived',
          tasks: [{ assignee: 'ghost' }],
        },
      ],
    } as never)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)

    const res = await handler({
      request: new Request('http://localhost/api/crew-status'),
    })

    expect(res.status).toBe(401)
  })

  it('derives assigned task counts from the kanban board instead of gateway /api/tasks', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const res = await handler({
      request: new Request('http://localhost/api/crew-status'),
    })

    expect(res.status).toBe(200)
    expect(getKanbanBoard).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks?include_done=false'),
      expect.anything(),
    )

    const body = await res.json()
    const byId = Object.fromEntries(
      body.crew.map((member: any) => [member.id, member]),
    )
    expect(byId.workspace.assignedTaskCount).toBe(2)
    expect(byId.workspace.assignedTaskCount).not.toBe(3)
  })

  async function neoActivity(command: string) {
    paths.root = mkdtempSync(join(tmpdir(), 'crew-status-'))
    mkdirSync(join(paths.root, 'profiles', 'neo'), { recursive: true })
    seedProfileDb(join(paths.root, 'profiles', 'neo', 'state.db'), command)
    try {
      const res = await handler({
        request: new Request('http://localhost/api/crew-status'),
      })
      const body = await res.json()
      return body.crew.find((member: any) => member.id === 'neo')
    } finally {
      paths.root = '/tmp/missing-root'
    }
  }

  it('redacts secrets from tool arg previews', async () => {
    const neo = await neoActivity(
      'curl -H "Authorization: Bearer abc.def" https://bob:hunter2@x.io/?api_key=zzz sk-live1234567 ghp_abcdef TOKEN=s3cret',
    )
    const preview: string = neo.activity.tool.argsPreview
    for (const secret of [
      'abc.def',
      'hunter2',
      'zzz',
      'sk-live1234567',
      'ghp_abcdef',
      's3cret',
    ]) {
      expect(preview).not.toContain(secret)
    }
    expect(preview).toContain('[redacted]')
  })

  it('previews only command-like fields, never raw args', async () => {
    paths.root = mkdtempSync(join(tmpdir(), 'crew-status-'))
    mkdirSync(join(paths.root, 'profiles', 'neo'), { recursive: true })
    const dbPath = join(paths.root, 'profiles', 'neo', 'state.db')
    seedProfileDb(dbPath)
    execFileSync('python3', [
      '-c',
      `import json, sqlite3, sys, time
c = sqlite3.connect(sys.argv[1])
calls = [{"function": {"name": "send_message", "arguments": json.dumps({"text": "private note", "password": "p"})}}]
c.execute("INSERT INTO messages (session_id, role, content, tool_calls, timestamp) VALUES ('live', 'assistant', '', ?, ?)", (json.dumps(calls), time.time() - 1))
c.commit()`,
      dbPath,
    ])
    try {
      const res = await handler({
        request: new Request('http://localhost/api/crew-status'),
      })
      const neo = (await res.json()).crew.find((m: any) => m.id === 'neo')
      expect(neo.activity.tool).toMatchObject({
        name: 'send_message',
        argsPreview: '',
      })
    } finally {
      paths.root = '/tmp/missing-root'
    }
  })

  it('reports per-profile activity from state.db (tool, heartbeat)', async () => {
    paths.root = mkdtempSync(join(tmpdir(), 'crew-status-'))
    mkdirSync(join(paths.root, 'profiles', 'neo'), { recursive: true })
    seedProfileDb(join(paths.root, 'profiles', 'neo', 'state.db'))
    try {
      const res = await handler({
        request: new Request('http://localhost/api/crew-status'),
      })
      const body = await res.json()
      const neo = body.crew.find((member: any) => member.id === 'neo')
      expect(neo.isActive).toBe(true)
      expect(neo.activeSessionKey).toBe('live')
      expect(neo.activity).toMatchObject({
        sessionKey: 'live',
        description: 'terminal command running (111s elapsed)',
        tool: { name: 'terminal', argsPreview: 'pnpm test' },
      })
      expect(neo.activity.at).toBeGreaterThan(Date.now() - 60_000)
      expect(neo.activity.tool.at).toBeGreaterThan(Date.now() - 60_000)
      expect(neo.activity).not.toHaveProperty('lastUserMessage')
      expect(neo.liveSessions).toEqual(
        expect.arrayContaining([
          { id: 'live', source: 'telegram' },
          { id: 'cron-1', source: 'cron' },
        ]),
      )
    } finally {
      paths.root = '/tmp/missing-root'
    }
  })
})
