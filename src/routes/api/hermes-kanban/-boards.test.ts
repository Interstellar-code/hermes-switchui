import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => ({ options: opts }),
}))

vi.mock('@tanstack/react-start', () => ({
  json: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
      ...(init || {}),
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    }),
}))

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../../server/hermes-kanban-client', () => ({
  listBoards: vi.fn(),
  createBoard: vi.fn(),
  updateBoard: vi.fn(),
  deleteBoard: vi.fn(),
  switchBoard: vi.fn(),
}))

import { isAuthenticated } from '../../../server/auth-middleware'
import {
  createBoard,
  deleteBoard,
  listBoards,
  switchBoard,
  updateBoard,
} from '../../../server/hermes-kanban-client'
import { Route as BoardsRoute } from './boards'
import { Route as BoardSlugRoute } from './boards.$slug'
import { Route as BoardSwitchRoute } from './boards.$slug.switch'

const boardsHandlers = (BoardsRoute as any).options.server.handlers as any
const boardSlugHandlers = (BoardSlugRoute as any).options.server.handlers as any
const boardSwitchHandlers = (BoardSwitchRoute as any).options.server.handlers as any

const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockListBoards = vi.mocked(listBoards)
const mockCreateBoard = vi.mocked(createBoard)
const mockUpdateBoard = vi.mocked(updateBoard)
const mockDeleteBoard = vi.mocked(deleteBoard)
const mockSwitchBoard = vi.mocked(switchBoard)

function makeRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsAuthenticated.mockReturnValue(true)
})

describe('GET /api/hermes-kanban/boards', () => {
  it('returns the list response shape', async () => {
    mockListBoards.mockResolvedValue({
      boards: [{ slug: 'default', name: 'Default' } as never],
      current: 'default',
    })
    const res = await boardsHandlers.GET({
      request: makeRequest('GET', 'http://localhost/api/hermes-kanban/boards'),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.current).toBe('default')
    expect(body.boards).toHaveLength(1)
  })

  it('returns 503 when the dashboard is down', async () => {
    mockListBoards.mockRejectedValue(new Error('Kanban API error 503: dashboard offline'))
    const res = await boardsHandlers.GET({
      request: makeRequest('GET', 'http://localhost/api/hermes-kanban/boards'),
    })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.mode).toBe('dashboard-unavailable')
  })
})

describe('POST /api/hermes-kanban/boards', () => {
  it('returns the existing board for an idempotent same-slug create, not 409', async () => {
    mockCreateBoard.mockResolvedValue({
      board: { slug: 'ops', name: 'Ops' } as never,
      current: 'default',
    })
    const res = await boardsHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/hermes-kanban/boards', {
        slug: 'ops',
        name: 'Ops',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.board.slug).toBe('ops')
  })

  it('returns 400 for malformed slug input', async () => {
    mockCreateBoard.mockRejectedValue(new Error('Kanban API error 400: invalid slug'))
    const res = await boardsHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/hermes-kanban/boards', {
        slug: 'Bad Slug',
      }),
    })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/hermes-kanban/boards/:slug', () => {
  it('returns 400 for unknown slug because the agent API does', async () => {
    mockUpdateBoard.mockRejectedValue(new Error('Kanban API error 400: unknown slug'))
    const res = await boardSlugHandlers.PATCH({
      request: makeRequest('PATCH', 'http://localhost/api/hermes-kanban/boards/nope', {
        name: 'Nope',
      }),
      params: { slug: 'nope' },
    })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/hermes-kanban/boards/:slug', () => {
  it('returns 400 for unknown slug because the agent API does', async () => {
    mockDeleteBoard.mockRejectedValue(new Error('Kanban API error 400: unknown slug'))
    const res = await boardSlugHandlers.DELETE({
      request: makeRequest('DELETE', 'http://localhost/api/hermes-kanban/boards/nope'),
      params: { slug: 'nope' },
    })
    expect(res.status).toBe(400)
  })

  it('returns current:default after deleting the active non-default board', async () => {
    mockDeleteBoard.mockResolvedValue({
      result: { slug: 'ops', action: 'deleted' },
      current: 'default',
    })
    const res = await boardSlugHandlers.DELETE({
      request: makeRequest('DELETE', 'http://localhost/api/hermes-kanban/boards/ops?delete=true'),
      params: { slug: 'ops' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.current).toBe('default')
  })
})

describe('POST /api/hermes-kanban/boards/:slug/switch', () => {
  it('switches the active board', async () => {
    mockSwitchBoard.mockResolvedValue({ current: 'research' })
    const res = await boardSwitchHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/hermes-kanban/boards/research/switch'),
      params: { slug: 'research' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.current).toBe('research')
  })
})
