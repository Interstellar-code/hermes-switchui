import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('templatesKeys', () => {
  it("list is byte-identical to today's bare key when unscoped", async () => {
    const { templatesKeys } = await import('./board-templates-api')
    expect(templatesKeys.list(null)).toEqual(['hermes-kanban', 'templates', 'list'])
  })

  it("detail is byte-identical to today's bare key when unscoped", async () => {
    const { templatesKeys } = await import('./board-templates-api')
    expect(templatesKeys.detail('my-slug', null)).toEqual([
      'hermes-kanban',
      'templates',
      'detail',
      'my-slug',
    ])
  })

  it('list differs across two profiles, and from unscoped', async () => {
    const { templatesKeys } = await import('./board-templates-api')
    const neo = templatesKeys.list('neo')
    const trinity = templatesKeys.list('trinity')
    const unscoped = templatesKeys.list(null)
    expect(JSON.stringify(neo)).not.toBe(JSON.stringify(trinity))
    expect(JSON.stringify(neo)).not.toBe(JSON.stringify(unscoped))
    expect(JSON.stringify(trinity)).not.toBe(JSON.stringify(unscoped))
  })

  it('detail differs across two profiles for the same slug, and from unscoped', async () => {
    const { templatesKeys } = await import('./board-templates-api')
    const neo = templatesKeys.detail('proj', 'neo')
    const trinity = templatesKeys.detail('proj', 'trinity')
    const unscoped = templatesKeys.detail('proj', null)
    expect(JSON.stringify(neo)).not.toBe(JSON.stringify(trinity))
    expect(JSON.stringify(neo)).not.toBe(JSON.stringify(unscoped))
    expect(JSON.stringify(trinity)).not.toBe(JSON.stringify(unscoped))
  })

  it('all stays an unscoped prefix of every list(...)/detail(...) key, so invalidateQueries({queryKey: templatesKeys.all}) still matches a profile-scoped entry', async () => {
    const { templatesKeys } = await import('./board-templates-api')
    const scopedList = templatesKeys.list('neo')
    const scopedDetail = templatesKeys.detail('proj', 'neo')
    expect(templatesKeys.all.every((segment, i) => segment === scopedList[i])).toBe(true)
    expect(templatesKeys.all.every((segment, i) => segment === scopedDetail[i])).toBe(true)
  })
})

describe('templatesJson request helpers', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function ok(body: unknown, status = 200): Response {
    return {
      ok: true,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response
  }

  it('fetchTemplates calls /api/hermes-kanban/templates', async () => {
    mockFetch.mockResolvedValueOnce(ok({ templates: [] }))
    const { fetchTemplates } = await import('./board-templates-api')
    const result = await fetchTemplates()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/hermes-kanban/templates')
    expect(result.templates).toEqual([])
  })
})
