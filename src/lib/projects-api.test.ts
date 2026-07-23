import { describe, expect, it, vi } from 'vitest'
import {
  bindSessionProject,
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
