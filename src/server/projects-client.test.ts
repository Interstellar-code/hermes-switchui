import { afterEach, describe, expect, it, vi } from 'vitest'

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
        '/api/plugins/projects',
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
      await expect(listProjects()).rejects.toThrow(
        /503|Service unavailable/i,
      )
    })
  })

  describe('getProject', () => {
    it('calls /api/plugins/projects/:idOrSlug', async () => {
      mockDashboardFetch.mockResolvedValueOnce(
        makeOkResponse({ project: { id: 'p_1', slug: 'demo' } }),
      )
      const { getProject } = await import('./projects-client')
      const result = await getProject('demo')
      expect(result.project.slug).toBe('demo')
      expect(mockDashboardFetch).toHaveBeenCalledWith(
        '/api/plugins/projects/demo',
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
        '/api/plugins/projects/demo/folders',
        expect.any(Object),
      )
    })
  })
})
