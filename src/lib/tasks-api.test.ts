import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function ok(body: unknown, status = 200): Response {
  return { ok: true, status, json: async () => body } as unknown as Response
}

describe('tasks-api (Agent Kanban backend)', () => {
  it('fetchTasks calls /api/hermes-kanban/board and flattens columns', async () => {
    mockFetch.mockResolvedValueOnce(
      ok({
        board: {
          // Agent API returns columns as a [{name, tasks}] list, not a dict
          columns: [
            { name: 'triage', tasks: [{ id: 't1', title: 'T1', status: 'triage', priority: 0, spawn_failures: 0 }] },
            { name: 'todo', tasks: [] },
            { name: 'ready', tasks: [] },
            { name: 'running', tasks: [] },
            { name: 'blocked', tasks: [] },
            { name: 'done', tasks: [] },
          ],
          tenants: [],
          assignees: [],
          latest_event_id: null,
        },
      }),
    )
    const { fetchTasks } = await import('./tasks-api')
    const tasks = await fetchTasks({ include_done: false })
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('/api/hermes-kanban/board')
    expect(tasks.some((t) => t.id === 't1')).toBe(true)
  })

  it('createTask posts to /api/hermes-kanban/tasks with Agent fields', async () => {
    mockFetch.mockResolvedValueOnce(
      ok(
        {
          task: {
            id: 'new',
            title: 'New',
            status: 'triage',
            priority: 0,
            spawn_failures: 0,
          },
        },
        201,
      ),
    )
    const { createTask } = await import('./tasks-api')
    const task = await createTask({ title: 'New', triage: true })
    expect(task.id).toBe('new')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body).not.toHaveProperty('column')
    expect(body).toHaveProperty('title', 'New')
    expect(body).toHaveProperty('triage', true)
  })

  it('moveTask sends PATCH with status to /api/hermes-kanban/tasks/:id', async () => {
    mockFetch.mockResolvedValueOnce(
      ok({
        task: { id: 't2', status: 'running', priority: 0, spawn_failures: 0 },
      }),
    )
    const { moveTask } = await import('./tasks-api')
    await moveTask('t2', 'running')
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('/api/hermes-kanban/tasks/t2')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body).toMatchObject({ status: 'running' })
  })

  it('deleteTask sends PATCH status:archived (archive not hard-delete)', async () => {
    mockFetch.mockResolvedValueOnce(
      ok({
        task: { id: 't3', status: 'archived', priority: 0, spawn_failures: 0 },
      }),
    )
    const { deleteTask } = await import('./tasks-api')
    await deleteTask('t3')
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('/api/hermes-kanban/tasks/t3')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body).toMatchObject({ status: 'archived' })
  })

  it('fetchAssignees calls /api/hermes-kanban/assignees', async () => {
    mockFetch.mockResolvedValueOnce(ok({ assignees: [] }))
    const { fetchAssignees } = await import('./tasks-api')
    const result = await fetchAssignees()
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('/api/hermes-kanban/assignees')
    expect(result.assignees).toEqual([])
  })
})
