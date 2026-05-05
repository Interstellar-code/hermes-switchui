import { afterEach, describe, expect, it, vi } from 'vitest'

const mockDashboardFetch = vi.fn()

vi.mock('./gateway-capabilities', () => ({
  dashboardFetch: mockDashboardFetch,
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
  it('calls the correct board path', async () => {
    mockDashboardFetch.mockResolvedValueOnce(
      makeOkResponse({ columns: [], tenants: [], assignees: [], latest_event_id: null }),
    )
    const { getKanbanBoard } = await import('./hermes-kanban-client')
    await getKanbanBoard()
    expect(mockDashboardFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/plugins/kanban/board'),
      expect.any(Object),
    )
  })

  it('passes tenant and include_archived query params', async () => {
    mockDashboardFetch.mockResolvedValueOnce(
      makeOkResponse({ columns: [], tenants: [], assignees: [], latest_event_id: null }),
    )
    const { getKanbanBoard } = await import('./hermes-kanban-client')
    await getKanbanBoard({ tenant: 'mission-1', includeArchived: true })
    const calledPath: string = mockDashboardFetch.mock.calls[0][0]
    expect(calledPath).toContain('tenant=mission-1')
    expect(calledPath).toContain('include_archived=true')
  })

  it('throws a useful error on non-OK response', async () => {
    mockDashboardFetch.mockResolvedValueOnce(
      makeErrorResponse(503, { detail: 'Service unavailable' }),
    )
    const { getKanbanBoard } = await import('./hermes-kanban-client')
    await expect(getKanbanBoard()).rejects.toThrow(/503|Service unavailable/i)
  })

  it('sends POST to create task with agent-native fields', async () => {
    mockDashboardFetch.mockResolvedValueOnce(
      makeOkResponse({ task: { id: 't_001', title: 'Test', status: 'triage' } }),
    )
    const { createKanbanTask } = await import('./hermes-kanban-client')
    const result = await createKanbanTask({ title: 'Test', triage: true, priority: 1 })
    expect(result.task.id).toBe('t_001')
    const body = JSON.parse(mockDashboardFetch.mock.calls[0][1].body as string)
    expect(body).not.toHaveProperty('column')
    expect(body).toHaveProperty('title', 'Test')
    expect(body).toHaveProperty('triage', true)
  })

  it('sends PATCH with task id in path', async () => {
    mockDashboardFetch.mockResolvedValueOnce(
      makeOkResponse({ task: { id: 't_002', status: 'done' } }),
    )
    const { updateKanbanTask } = await import('./hermes-kanban-client')
    await updateKanbanTask('t_002', { status: 'done', result: 'completed' })
    const calledPath: string = mockDashboardFetch.mock.calls[0][0]
    expect(calledPath).toContain('/api/plugins/kanban/tasks/t_002')
  })

  it('sends POST to comments endpoint', async () => {
    mockDashboardFetch.mockResolvedValueOnce(makeOkResponse({ ok: true }))
    const { addKanbanComment } = await import('./hermes-kanban-client')
    await addKanbanComment('t_003', { body: 'hello', author: 'Workspace' })
    const calledPath: string = mockDashboardFetch.mock.calls[0][0]
    expect(calledPath).toContain('/api/plugins/kanban/tasks/t_003/comments')
  })

  it('sends POST to /tasks/bulk', async () => {
    mockDashboardFetch.mockResolvedValueOnce(makeOkResponse({ results: [] }))
    const { bulkUpdateKanbanTasks } = await import('./hermes-kanban-client')
    await bulkUpdateKanbanTasks({ ids: ['t_1', 't_2'], status: 'done' })
    const calledPath: string = mockDashboardFetch.mock.calls[0][0]
    expect(calledPath).toContain('/api/plugins/kanban/tasks/bulk')
  })
})
