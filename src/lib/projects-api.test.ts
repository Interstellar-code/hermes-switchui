import { describe, expect, it, vi } from 'vitest'
import {
  bindSessionProject,
  createProject,
  fetchProject,
  fetchProjectActivity,
  fetchProjectFolders,
  fetchProjects,
  fetchSessionProject,
  fetchSessionProjectMap,
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
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
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
  it('uses a session- and profile-specific cache key', () => {
    expect(projectsKeys.session('chat-a')).not.toEqual(
      projectsKeys.session('chat-b'),
    )
    expect(projectsKeys.session('chat-a', 'work')).not.toEqual(
      projectsKeys.session('chat-a', 'home'),
    )
  })

  it('resolves the session project in the same profile bind/unbind write to', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await fetchSessionProject('chat-a', 'work')
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/hermes-projects/session?sessionKey=chat-a&profile=work',
    )
  })

  it('never sends a request for a placeholder session key', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchSessionProject('new')).toMatchObject({ project: null })
    expect(
      await bindSessionProject({ sessionKey: 'new', projectSlug: 'demo' }),
    ).toBeNull()
    expect(await unbindSessionProject(' ')).toMatchObject({ removed: 0 })
    expect(await fetchSessionProject('main')).toMatchObject({ project: null })
    expect(fetchMock).not.toHaveBeenCalled()
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

  it('scopes binding writes and the session map to a profile', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await bindSessionProject({
      sessionKey: 'chat-a',
      projectSlug: 'demo',
      profile: 'work',
    })
    await unbindSessionProject('chat-a', 'work')
    await fetchSessionProjectMap('work')

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/hermes-projects/session?sessionKey=chat-a&profile=work',
      '/api/hermes-projects/session?sessionKey=chat-a&profile=work',
      '/api/session-folders?profile=work',
    ])
    expect(projectsKeys.sessionMap('a')).not.toEqual(
      projectsKeys.sessionMap('b'),
    )
    expect(projectsKeys.sessionMap('a').slice(0, 2)).toEqual(
      projectsKeys.sessionMapAll,
    )
  })
})
