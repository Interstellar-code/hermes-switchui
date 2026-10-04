import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { getSessionProjectMap } from '../../server/projects-client'
import { Route } from './session-folders'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => ({ options: opts }),
}))
vi.mock('../../server/auth-middleware', () => ({ isAuthenticated: vi.fn() }))
vi.mock('../../server/projects-client', () => ({
  getSessionProjectMap: vi.fn(),
  explicitProjectProfile: (request: Request) =>
    new URL(request.url).searchParams.get('profile') || undefined,
  projectsErrorStatus: () => 503,
}))

const { GET } = (Route as any).options.server.handlers
const mockAuth = vi.mocked(isAuthenticated)
const mockMap = vi.mocked(getSessionProjectMap)
const URL_BASE = 'http://localhost/api/session-folders'
const MAP = {
  version: 'v1',
  projects: [
    {
      id: 'p1',
      slug: 'a',
      name: 'A',
      icon: null,
      color: null,
      archived: false,
      board_slug: null,
    },
  ],
  sessions: { s1: 'p1', s2: 'p1' },
  inherited: { s2: true as const },
  counts: { p1: 2 },
  listable_total: 5,
  unfiled: 3,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockReturnValue(true)
})

describe('GET /api/session-folders', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockReturnValue(false)
    const res = await GET({ request: new Request(URL_BASE) })
    expect(res.status).toBe(401)
    expect(mockMap).not.toHaveBeenCalled()
  })

  it('400 on invalid profile', async () => {
    const res = await GET({ request: new Request(`${URL_BASE}?profile=Bad!!`) })
    expect(res.status).toBe(400)
  })

  it('returns the map with ETag and forwards profile + If-None-Match', async () => {
    mockMap.mockResolvedValue({ notModified: false, etag: '"abc"', map: MAP })
    const res = await GET({
      request: new Request(`${URL_BASE}?profile=default`, {
        headers: { 'If-None-Match': '"old"' },
      }),
    })
    expect(mockMap).toHaveBeenCalledWith('default', '"old"')
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBe('"abc"')
    expect(await res.json()).toEqual({ ok: true, ...MAP })
  })

  it('passes through 304', async () => {
    mockMap.mockResolvedValue({ notModified: true, etag: '"abc"' })
    const res = await GET({ request: new Request(URL_BASE) })
    expect(mockMap).toHaveBeenCalledWith(undefined, undefined)
    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe('"abc"')
  })

  it('503 when the dashboard is down', async () => {
    mockMap.mockRejectedValue(new Error('fetch failed'))
    const res = await GET({ request: new Request(URL_BASE) })
    expect(res.status).toBe(503)
    expect((await res.json()).ok).toBe(false)
  })
})
