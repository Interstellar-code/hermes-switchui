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

vi.mock('../../server/claude-paths', () => ({
  getClaudeRoot: () => '/tmp/missing-root',
  getProfileClaudeHome: (profile: string) => `/tmp/missing-root/profiles/${profile}`,
  getWorkspaceClaudeHome: () => '/tmp/missing-root',
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
    const byId = Object.fromEntries(body.crew.map((member: any) => [member.id, member]))
    expect(byId.workspace.assignedTaskCount).toBe(2)
    expect(byId.workspace.assignedTaskCount).not.toBe(3)
  })
})
