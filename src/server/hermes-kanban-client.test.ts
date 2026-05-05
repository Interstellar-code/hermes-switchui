import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// dashboardFetch is the authenticated helper in gateway-capabilities.ts
const mockDashboardFetch = vi.fn()

vi.mock('./gateway-capabilities', () => ({
  dashboardFetch: mockDashboardFetch,
  CLAUDE_DASHBOARD_URL: 'http://127.0.0.1:9119',
}))

afterEach(() => {
  vi.clearAllMocks()
})

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function makeErrorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('hermes-kanban-client', () => {
  describe('getKanbanBoard', () => {
    it('calls the correct dashboard path', async () => {
      mockDashboardFetch.mockResolvedValueOnce(makeOkResponse({ columns: {}, tenants: [], assignees: [], latest_event_id: null }))
      const { getKanbanBoard } = await import('./hermes-kanban-client')
      await getKanbanBoard()
      expect(mockDashboardFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/kanban/board'),
        expect.any(Object),
      )
    })

    it('passes tenant and include_archived as query params', async () => {
      mockDashboardFetch.mockResolvedValueOnce(makeOkResponse({ columns: {}, tenants: [], assignees: [], latest_event_id: null }))
      const { getKanbanBoard } = await import('./hermes-kanban-client')
      await getKanbanBoard({ tenant: 'mission-1', includeArchived: true })
      const calledPath: string = mockDashboardFetch.mock.calls[0][0]
      expect(calledPath).toContain('tenant=mission-1')
      expect(calledPath).toContain('include_archived=true')
    })

    it('throws a useful error on non-OK response', async () => {
      mockDashboardFetch.mockResolvedValueOnce(makeErrorResponse(503, { detail: 'Service unavailable' }))
      const { getKanbanBoard } = await import('./hermes-kanban-client')
      await expect(getKanbanBoard()).rejects.toThrow(/503|Service unavailable/i)
    })
  })

  describe('createKanbanTask', () => {
    it('sends POST to /api/plugins/kanban/tasks with Agent-native fields', async () => {
      mockDashboardFetch.mockResolvedValueOnce(makeOkResponse({ task: { id: 't_001', title: 'Test', status: 'triage' } }))
      const { createKanbanTask } = await import('./hermes-kanban-client')
      const result = await createKanbanTask({ title: 'Test', triage: true, priority: 1 })
      expect(result.task.id).toBe('t_001')
      expect(mockDashboardFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/kanban/tasks'),
        expect.objectContaining({ method: 'POST' }),
      )
      // Must NOT send legacy 'column' field
      const body = JSON.parse(mockDashboardFetch.mock.calls[0][1].body as string)
      expect(body).not.toHaveProperty('column')
      expect(body).toHaveProperty('title', 'Test')
      expect(body).toHaveProperty('triage', true)
    })
  })

  describe('updateKanbanTask', () => {
    it('sends PATCH with task id in path', async () => {
      mockDashboardFetch.mockResolvedValueOnce(makeOkResponse({ task: { id: 't_002', status: 'done' } }))
      const { updateKanbanTask } = await import('./hermes-kanban-client')
      await updateKanbanTask('t_002', { status: 'done', result: 'completed' })
      const calledPath: string = mockDashboardFetch.mock.calls[0][0]
      expect(calledPath).toContain('/api/plugins/kanban/tasks/t_002')
      expect(mockDashboardFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })

  describe('addKanbanComment', () => {
    it('sends POST to comments endpoint', async () => {
      mockDashboardFetch.mockResolvedValueOnce(makeOkResponse({ ok: true }))
      const { addKanbanComment } = await import('./hermes-kanban-client')
      await addKanbanComment('t_003', { body: 'hello', author: 'SwitchUI' })
      const calledPath: string = mockDashboardFetch.mock.calls[0][0]
      expect(calledPath).toContain('/api/plugins/kanban/tasks/t_003/comments')
    })
  })

  describe('bulkUpdateKanbanTasks', () => {
    it('sends POST to /tasks/bulk', async () => {
      mockDashboardFetch.mockResolvedValueOnce(makeOkResponse({ results: [] }))
      const { bulkUpdateKanbanTasks } = await import('./hermes-kanban-client')
      await bulkUpdateKanbanTasks({ ids: ['t_1', 't_2'], status: 'done' })
      const calledPath: string = mockDashboardFetch.mock.calls[0][0]
      expect(calledPath).toContain('/api/plugins/kanban/tasks/bulk')
    })
  })

  describe('dispatchKanban', () => {
    it('sends POST to /dispatch with max param', async () => {
      mockDashboardFetch.mockResolvedValueOnce(makeOkResponse({ dispatched: 2 }))
      const { dispatchKanban } = await import('./hermes-kanban-client')
      await dispatchKanban(8)
      const calledPath: string = mockDashboardFetch.mock.calls[0][0]
      expect(calledPath).toContain('/api/plugins/kanban/dispatch')
      expect(calledPath).toContain('max=8')
    })
  })
})
