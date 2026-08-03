import { describe, expect, it, vi } from 'vitest'
import {
  bindSessionProject,
  createProject,
  fetchProject,
  fetchProjectActivity,
  fetchProjectFolders,
  fetchProjects,
  fetchSessionProject,
  invalidateProjectQueries,
  projectsKeys,
  unbindSessionProject,
} from './projects-api'

describe('Projects mutations', () => {
  it('invalidates all Projects queries after a successful write', () => {
    const invalidateQueries = vi.fn()
    invalidateProjectQueries({ invalidateQueries } as never)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: projectsKeys.all,
    })
  })

  it('routes reads and writes through the explicitly selected profile', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchProjects(false, 'work profile')
    await fetchProject('demo', 'work profile')
    await fetchProjectFolders('demo', 'work profile')
    await fetchProjectActivity('demo', undefined, 'work profile')
    await createProject({ name: 'Demo' }, 'work profile')

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/hermes-projects?profile=work+profile',
      '/api/hermes-projects/demo?profile=work%20profile',
      '/api/hermes-projects/demo/folders?profile=work%20profile',
      '/api/hermes-projects/demo/activity?profile=work%20profile',
      '/api/hermes-projects?profile=work%20profile',
    ])
  })

  it('separates profile-scoped query keys', () => {
    expect(projectsKeys.detail('demo', 'alpha')).not.toEqual(
      projectsKeys.detail('demo', 'beta'),
    )
    expect(projectsKeys.folders('demo', 'alpha')).not.toEqual(
      projectsKeys.folders('demo', 'beta'),
    )
    expect(projectsKeys.activity('demo', 'alpha')).not.toEqual(
      projectsKeys.activity('demo', 'beta'),
    )
  })
})

describe('Session project client', () => {
  it('uses a session-specific cache key', () => {
    expect(projectsKeys.session('chat-a')).not.toEqual(
      projectsKeys.session('chat-b'),
    )
  })

  it('calls the session binding endpoint', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchSessionProject('chat-a')
    await bindSessionProject({ sessionKey: 'chat-a', projectSlug: 'demo' })
    await unbindSessionProject('chat-a')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/hermes-projects/session?sessionKey=chat-a',
      undefined,
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/hermes-projects/session?sessionKey=chat-a',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ project_slug: 'demo' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/hermes-projects/session?sessionKey=chat-a',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
