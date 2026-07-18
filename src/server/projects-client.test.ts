import { afterEach, describe, expect, it, vi } from 'vitest'

const mockDashboardFetch = vi.fn()

vi.mock('./gateway-capabilities', () => ({
  dashboardFetch: mockDashboardFetch,
  CLAUDE_DASHBOARD_URL: 'http://127.0.0.1:9119',
}))

vi.mock('./profiles-browser', () => ({
  getActiveProfileName: () => 'hermes-switch',
}))

afterEach(() => {
  vi.clearAllMocks()
})

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => body,
    text: () => JSON.stringify(body),
  } as unknown as Response
}

function makeErrorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    json: () => body,
    text: () => JSON.stringify(body),
  } as unknown as Response
}

describe('projects-client', () => {
  describe('listProjects', () => {
    it('calls the correct dashboard path', async () => {
      mockDashboardFetch.mockResolvedValueOnce(
        makeOkResponse({ projects: [], active_id: null }),
      )
      const { listProjects } = await import('./projects-client')
      await listProjects()
      expect(mockDashboardFetch).toHaveBeenCalledWith(
        '/api/plugins/projects?profile=hermes-switch',
        expect.any(Object),
      )
    })

    it('passes include_archived as a query param', async () => {
      mockDashboardFetch.mockResolvedValueOnce(
        makeOkResponse({ projects: [], active_id: null }),
      )
      const { listProjects } = await import('./projects-client')
      await listProjects(true)
      const calledPath: string = mockDashboardFetch.mock.calls[0][0]
      expect(calledPath).toContain('include_archived=true')
    })

    it('throws a useful error on non-OK response', async () => {
      mockDashboardFetch.mockResolvedValueOnce(
        makeErrorResponse(503, { detail: 'Service unavailable' }),
      )
      const { listProjects } = await import('./projects-client')
      await expect(listProjects()).rejects.toThrow(/503|Service unavailable/i)
    })
  })

  describe('getProject', () => {
    it('calls /api/plugins/projects/:idOrSlug', async () => {
      mockDashboardFetch.mockResolvedValueOnce(
        makeOkResponse({
          project: {
            id: 'p_1',
            slug: 'demo',
            bound_board: {
              slug: 'demo-board',
              name: 'Demo Board',
              description: 'A demo board',
              icon: 'kanban',
              color: '#4f46e5',
              archived: false,
            },
            folder_count: 2,
            task_count: 12,
            open_task_count: 5,
            task_status_counts: { open: 5, done: 7 },
            session_count: 3,
            last_task_activity_at: 1_752_800_000,
            last_session_activity_at: 1_752_810_000,
            last_activity_at: 1_752_810_000,
            is_active: true,
          },
        }),
      )
      const { getProject } = await import('./projects-client')
      const result = await getProject('demo')
      expect(result.project.slug).toBe('demo')
      expect(result.project.bound_board?.slug).toBe('demo-board')
      expect(result.project.is_active).toBe(true)
      expect(mockDashboardFetch).toHaveBeenCalledWith(
        '/api/plugins/projects/demo?profile=hermes-switch',
        expect.any(Object),
      )
    })

    it('throws with 404 detail when project not found', async () => {
      mockDashboardFetch.mockResolvedValueOnce(
        makeErrorResponse(404, { detail: 'project not found' }),
      )
      const { getProject } = await import('./projects-client')
      await expect(getProject('missing')).rejects.toThrow(
        /404|project not found/i,
      )
    })
  })

  describe('getProjectFolders', () => {
    it('calls /api/plugins/projects/:idOrSlug/folders', async () => {
      mockDashboardFetch.mockResolvedValueOnce(
        makeOkResponse({ project_id: 'p_1', folders: [] }),
      )
      const { getProjectFolders } = await import('./projects-client')
      await getProjectFolders('demo')
      expect(mockDashboardFetch).toHaveBeenCalledWith(
        '/api/plugins/projects/demo/folders?profile=hermes-switch',
        expect.any(Object),
      )
    })
  })

  describe('project mutations', () => {
    it('preserves backend validation status for the BFF', async () => {
      const { projectsErrorStatus } = await import('./projects-client')
      expect(
        projectsErrorStatus(
          new Error('Projects API error 422: null is not allowed for: name'),
        ),
      ).toBe(422)
      expect(projectsErrorStatus(new Error('network error'))).toBe(503)
    })

    it('formats FastAPI validation details without stringifying objects', async () => {
      mockDashboardFetch.mockResolvedValueOnce(
        makeErrorResponse(422, {
          detail: [{ msg: 'Extra inputs are not permitted' }],
        }),
      )
      const { createProject } = await import('./projects-client')
      await expect(createProject({ name: 'Demo' })).rejects.toThrow(
        'Extra inputs are not permitted',
      )
    })

    it('sends create payload to the collection endpoint', async () => {
      mockDashboardFetch.mockResolvedValueOnce(
        makeOkResponse({ project: { id: 'p_1' } }),
      )
      const { createProject } = await import('./projects-client')
      await createProject({ name: 'Demo', folders: ['/repo/demo'] })
      expect(mockDashboardFetch).toHaveBeenCalledWith(
        '/api/plugins/projects?profile=hermes-switch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Demo', folders: ['/repo/demo'] }),
        }),
      )
    })

    it('keeps absolute folder paths in the JSON body', async () => {
      mockDashboardFetch.mockResolvedValueOnce(
        makeOkResponse({ project: { id: 'p_1' } }),
      )
      const { removeProjectFolder } = await import('./projects-client')
      await removeProjectFolder('demo', '/Users/rohits/Development/demo')
      expect(mockDashboardFetch).toHaveBeenCalledWith(
        '/api/plugins/projects/demo/folders?profile=hermes-switch',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ path: '/Users/rohits/Development/demo' }),
        }),
      )
    })

    it('uses PATCH for top-level edits and POST for active pointer', async () => {
      mockDashboardFetch
        .mockResolvedValueOnce(makeOkResponse({ project: { id: 'p_1' } }))
        .mockResolvedValueOnce(
          makeOkResponse({ projects: [], active_id: 'p_1' }),
        )
      const { updateProject, setActiveProject } =
        await import('./projects-client')
      await updateProject('demo', { name: 'Renamed', board_slug: '' })
      await setActiveProject('demo')
      expect(mockDashboardFetch.mock.calls[0][1]).toEqual(
        expect.objectContaining({ method: 'PATCH' }),
      )
      expect(mockDashboardFetch.mock.calls[1][0]).toBe(
        '/api/plugins/projects/demo/active?profile=hermes-switch',
      )
      expect(mockDashboardFetch.mock.calls[1][1]).toEqual(
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  describe('getProjectActivity', () => {
    it('calls /api/plugins/projects/:idOrSlug/activity with default limit', async () => {
      mockDashboardFetch.mockResolvedValueOnce(
        makeOkResponse({ project_id: 'p_1', items: [], next_cursor: null }),
      )
      const { getProjectActivity } = await import('./projects-client')
      const result = await getProjectActivity('demo')
      expect(mockDashboardFetch).toHaveBeenCalledWith(
        '/api/plugins/projects/demo/activity?limit=10&profile=hermes-switch',
        expect.any(Object),
      )
      expect(result.next_cursor).toBeNull()
    })

    it('passes limit and cursor query params', async () => {
      mockDashboardFetch.mockResolvedValueOnce(
        makeOkResponse({ project_id: 'p_1', items: [], next_cursor: 'abc' }),
      )
      const { getProjectActivity } = await import('./projects-client')
      await getProjectActivity('demo', { limit: 25, cursor: 'xyz' })
      const calledPath: string = mockDashboardFetch.mock.calls[0][0]
      expect(calledPath).toContain('limit=25')
      expect(calledPath).toContain('cursor=xyz')
    })

    it('omits cursor param when cursor is null', async () => {
      mockDashboardFetch.mockResolvedValueOnce(
        makeOkResponse({ project_id: 'p_1', items: [], next_cursor: null }),
      )
      const { getProjectActivity } = await import('./projects-client')
      await getProjectActivity('demo', { cursor: null })
      const calledPath: string = mockDashboardFetch.mock.calls[0][0]
      expect(calledPath).not.toContain('cursor')
    })
  })
})
