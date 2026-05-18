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

describe('boards-api', () => {
  it('fetchBoards calls /api/hermes-kanban/boards', async () => {
    mockFetch.mockResolvedValueOnce(ok({ boards: [], current: 'default' }))
    const { fetchBoards } = await import('./boards-api')
    const result = await fetchBoards()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/hermes-kanban/boards')
    expect(result.current).toBe('default')
  })

  it('fetchCreateBoard posts slug in the request body', async () => {
    mockFetch.mockResolvedValueOnce(
      ok({ board: { slug: 'proj', name: 'Proj' }, current: 'proj' }, 201),
    )
    const { fetchCreateBoard } = await import('./boards-api')
    const result = await fetchCreateBoard({ slug: 'proj', name: 'Proj', switch: true })
    expect(result.current).toBe('proj')
    const [, init] = mockFetch.mock.calls[0]
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      slug: 'proj',
      name: 'Proj',
      switch: true,
    })
  })

  it('fetchDeleteBoard sets ?delete=true for hard delete', async () => {
    mockFetch.mockResolvedValueOnce(ok({ result: { slug: 'proj' }, current: 'default' }))
    const { fetchDeleteBoard } = await import('./boards-api')
    await fetchDeleteBoard('proj', true)
    expect(mockFetch.mock.calls[0][0]).toBe('/api/hermes-kanban/boards/proj?delete=true')
  })

  it('fetchSwitchBoard posts to /switch', async () => {
    mockFetch.mockResolvedValueOnce(ok({ current: 'proj' }))
    const { fetchSwitchBoard } = await import('./boards-api')
    const result = await fetchSwitchBoard('proj')
    expect(result.current).toBe('proj')
    expect(mockFetch.mock.calls[0][0]).toBe('/api/hermes-kanban/boards/proj/switch')
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: 'POST' })
  })
})
