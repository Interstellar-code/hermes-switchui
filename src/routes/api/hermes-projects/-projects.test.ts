import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../../server/auth-middleware'
import {
  bindSessionProject,
  createProject,
  getProject,
  getProjectFolders,
  listProjects,
  resolveSessionProject,
  unbindSessionProject,
} from '../../../server/projects-client'
import { Route as ProjectDetailRoute } from './$id'
import { Route as ProjectFoldersRoute } from './$id.folders'
import { Route as SessionProjectRoute } from './session'
import { Route as ProjectsIndexRoute } from './index'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => ({ options: opts }),
}))

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../../server/projects-client', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  getProject: vi.fn(),
  getProjectFolders: vi.fn(),
  resolveSessionProject: vi.fn(),
  bindSessionProject: vi.fn(),
  unbindSessionProject: vi.fn(),
  projectsErrorStatus: (error: unknown, fallback = 503) => {
    if (!(error instanceof Error)) return fallback
    const match = /^Projects API error (\d{3}):/.exec(error.message)
    return match ? Number(match[1]) : fallback
  },
}))

const indexHandlers = (ProjectsIndexRoute as any).options.server.handlers
const detailHandlers = (ProjectDetailRoute as any).options.server.handlers
const foldersHandlers = (ProjectFoldersRoute as any).options.server.handlers
const sessionHandlers = (SessionProjectRoute as any).options.server.handlers

const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockListProjects = vi.mocked(listProjects)
const mockCreateProject = vi.mocked(createProject)
const mockGetProject = vi.mocked(getProject)
const mockGetProjectFolders = vi.mocked(getProjectFolders)
const mockResolveSessionProject = vi.mocked(resolveSessionProject)
const mockBindSessionProject = vi.mocked(bindSessionProject)
const mockUnbindSessionProject = vi.mocked(unbindSessionProject)

function makeRequest(method: string, url: string): Request {
  return new Request(url, { method })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsAuthenticated.mockReturnValue(true)
})

describe('GET /api/hermes-projects', () => {
  it('returns the list response shape', async () => {
    mockListProjects.mockResolvedValue({
      projects: [{ id: 'p_1', slug: 'demo' } as never],
      active_id: 'p_1',
    })
    const res = await indexHandlers.GET({
      request: makeRequest('GET', 'http://localhost/api/hermes-projects'),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.active_id).toBe('p_1')
    expect(body.projects).toHaveLength(1)
  })

  it('returns 401 when unauthenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const res = await indexHandlers.GET({
      request: makeRequest('GET', 'http://localhost/api/hermes-projects'),
    })
    expect(res.status).toBe(401)
  })

  it('returns 503 when the dashboard is down', async () => {
    mockListProjects.mockRejectedValue(
      new Error('Projects API error 503: dashboard offline'),
    )
    const res = await indexHandlers.GET({
      request: makeRequest('GET', 'http://localhost/api/hermes-projects'),
    })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.mode).toBe('dashboard-unavailable')
  })
})

describe('POST /api/hermes-projects', () => {
  it('preserves backend 422 validation responses', async () => {
    mockCreateProject.mockRejectedValue(
      new Error('Projects API error 422: Extra inputs are not permitted'),
    )
    const res = await indexHandlers.POST({
      request: new Request('http://localhost/api/hermes-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Demo', unknown: true }),
      }),
    })
    expect(res.status).toBe(422)
  })
})

describe('GET /api/hermes-projects/:id', () => {
  it('returns the project detail', async () => {
    mockGetProject.mockResolvedValue({
      project: { id: 'p_1', slug: 'demo' } as never,
    })
    const res = await detailHandlers.GET({
      request: makeRequest('GET', 'http://localhost/api/hermes-projects/demo'),
      params: { id: 'demo' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.project.slug).toBe('demo')
  })

  it('returns 404 when not found', async () => {
    mockGetProject.mockRejectedValue(
      new Error('Projects API error 404: project not found'),
    )
    const res = await detailHandlers.GET({
      request: makeRequest(
        'GET',
        'http://localhost/api/hermes-projects/missing',
      ),
      params: { id: 'missing' },
    })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/hermes-projects/:id/folders', () => {
  it('returns the folders list', async () => {
    mockGetProjectFolders.mockResolvedValue({
      project_id: 'p_1',
      folders: [],
    })
    const res = await foldersHandlers.GET({
      request: makeRequest(
        'GET',
        'http://localhost/api/hermes-projects/demo/folders',
      ),
      params: { id: 'demo' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.project_id).toBe('p_1')
  })
})

describe('/api/hermes-projects/session', () => {
  it('resolves one session project', async () => {
    mockResolveSessionProject.mockResolvedValue({
      session_id: 'chat-a',
      project: { id: 'p_a', slug: 'alpha', name: 'Alpha' },
      source: 'binding',
    })
    const res = await sessionHandlers.GET({
      request: makeRequest(
        'GET',
        'http://localhost/api/hermes-projects/session?sessionKey=chat-a',
      ),
    })
    expect(res.status).toBe(200)
    expect(mockResolveSessionProject).toHaveBeenCalledWith('chat-a')
    expect((await res.json()).project.slug).toBe('alpha')
  })

  it('binds only the requested session', async () => {
    mockBindSessionProject.mockResolvedValue({
      binding: {},
      project: { id: 'p_a' },
    })
    const res = await sessionHandlers.POST({
      request: new Request(
        'http://localhost/api/hermes-projects/session?sessionKey=chat-a',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_slug: 'alpha' }),
        },
      ),
    })
    expect(res.status).toBe(200)
    expect(mockBindSessionProject).toHaveBeenCalledWith('chat-a', 'alpha')
  })

  it('unlinks only the requested session', async () => {
    mockUnbindSessionProject.mockResolvedValue({
      session_id: 'chat-a',
      removed: 1,
    })
    const res = await sessionHandlers.DELETE({
      request: new Request(
        'http://localhost/api/hermes-projects/session?sessionKey=chat-a',
        { method: 'DELETE', headers: { 'Content-Type': 'application/json' } },
      ),
    })
    expect(res.status).toBe(200)
    expect(mockUnbindSessionProject).toHaveBeenCalledWith('chat-a')
  })
})
