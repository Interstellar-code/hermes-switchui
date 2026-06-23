/**
 * CSRF guard tests for POST handlers missing requireJsonContentType (#158).
 *
 * Routes under test:
 *   POST /api/hermes-kanban/tasks           (tasks.ts)
 *   POST /api/hermes-kanban/tasks/:taskId/comments  (tasks.$taskId.comments.ts)
 *
 * Guard order for hermes-kanban routes (matches boards.ts / bulk.ts):
 *   CSRF first → auth second
 *   So: unauth + wrong Content-Type → 415 (CSRF fires before auth)
 *       unauth + correct Content-Type → 401
 *       auth  + wrong Content-Type   → 415
 *       auth  + correct Content-Type → reaches handler
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Top-level mocks (hoisted by Vitest)
// ---------------------------------------------------------------------------

const mockIsAuthenticated = vi.fn()
const mockRequireJsonContentType = vi.fn()
const mockCreateKanbanTask = vi.fn()
const mockAddKanbanComment = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: (...args: Array<unknown>) => mockIsAuthenticated(...args),
}))

vi.mock('../../../server/rate-limit', () => ({
  requireJsonContentType: (...args: Array<unknown>) => mockRequireJsonContentType(...args),
}))

vi.mock('../../../server/hermes-kanban-client', () => ({
  createKanbanTask: (...args: Array<unknown>) => mockCreateKanbanTask(...args),
  addKanbanComment: (...args: Array<unknown>) => mockAddKanbanComment(...args),
  // other exports the module may re-export — stub them so import doesn't fail
  listBoards: vi.fn(),
  createBoard: vi.fn(),
  updateBoard: vi.fn(),
  deleteBoard: vi.fn(),
  switchBoard: vi.fn(),
  getKanbanTask: vi.fn(),
  updateKanbanTask: vi.fn(),
  deleteKanbanTask: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Handler loader helpers (dynamic import AFTER mocks are set up)
// ---------------------------------------------------------------------------

async function getTasksPostHandler() {
  const mod = await import('./tasks')
  return (mod as unknown as {
    Route: { server: { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } } }
  }).Route.server.handlers.POST
}

async function getCommentsPostHandler() {
  const mod = await import('./tasks.$taskId.comments')
  return (mod as unknown as {
    Route: {
      server: {
        handlers: {
          POST: (ctx: { request: Request; params: { taskId: string } }) => Promise<Response>
        }
      }
    }
  }).Route.server.handlers.POST
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function jsonRequest(url: string, body?: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function plainRequest(url: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'form=data',
  })
}

const CSRF_415 = Response.json({ error: 'Unsupported Media Type' }, { status: 415 })

// ---------------------------------------------------------------------------
// POST /api/hermes-kanban/tasks
// ---------------------------------------------------------------------------

describe('POST /api/hermes-kanban/tasks — CSRF guard (#158)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(null) // guard passes by default
  })

  it('returns 415 for unauthenticated POST with wrong Content-Type (CSRF fires first)', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    mockRequireJsonContentType.mockReturnValue(CSRF_415)
    const handler = await getTasksPostHandler()
    const res = await handler({
      request: plainRequest('http://localhost/api/hermes-kanban/tasks'),
    })
    expect(res.status).toBe(415)
  })

  it('returns 401 for unauthenticated POST with correct Content-Type (CSRF passes, auth fails)', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    mockRequireJsonContentType.mockReturnValue(null) // CSRF passes
    const handler = await getTasksPostHandler()
    const res = await handler({
      request: jsonRequest('http://localhost/api/hermes-kanban/tasks', { title: 'New task' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 415 for authenticated POST with wrong Content-Type', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(CSRF_415)
    const handler = await getTasksPostHandler()
    const res = await handler({
      request: plainRequest('http://localhost/api/hermes-kanban/tasks'),
    })
    expect(res.status).toBe(415)
  })

  it('reaches handler (201) for authenticated POST with correct Content-Type', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(null)
    mockCreateKanbanTask.mockResolvedValue({ id: 't1', title: 'New task' })
    const handler = await getTasksPostHandler()
    const res = await handler({
      request: jsonRequest('http://localhost/api/hermes-kanban/tasks', { title: 'New task' }),
    })
    // Handler reached — must not be 415 or 401
    expect(res.status).not.toBe(415)
    expect(res.status).not.toBe(401)
    expect(res.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// POST /api/hermes-kanban/tasks/:taskId/comments
// ---------------------------------------------------------------------------

describe('POST /api/hermes-kanban/tasks/:taskId/comments — CSRF guard (#158)', () => {
  const TASK_URL = 'http://localhost/api/hermes-kanban/tasks/t1/comments'
  const PARAMS = { taskId: 't1' }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(null)
  })

  it('returns 415 for unauthenticated POST with wrong Content-Type (CSRF fires first)', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    mockRequireJsonContentType.mockReturnValue(CSRF_415)
    const handler = await getCommentsPostHandler()
    const res = await handler({
      request: plainRequest(TASK_URL),
      params: PARAMS,
    })
    expect(res.status).toBe(415)
  })

  it('returns 401 for unauthenticated POST with correct Content-Type (CSRF passes, auth fails)', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    mockRequireJsonContentType.mockReturnValue(null)
    const handler = await getCommentsPostHandler()
    const res = await handler({
      request: jsonRequest(TASK_URL, { body: 'great task' }),
      params: PARAMS,
    })
    expect(res.status).toBe(401)
  })

  it('returns 415 for authenticated POST with wrong Content-Type', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(CSRF_415)
    const handler = await getCommentsPostHandler()
    const res = await handler({
      request: plainRequest(TASK_URL),
      params: PARAMS,
    })
    expect(res.status).toBe(415)
  })

  it('reaches handler (201) for authenticated POST with correct Content-Type', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(null)
    mockAddKanbanComment.mockResolvedValue({ id: 'c1', body: 'great task' })
    const handler = await getCommentsPostHandler()
    const res = await handler({
      request: jsonRequest(TASK_URL, { body: 'great task' }),
      params: PARAMS,
    })
    expect(res.status).not.toBe(415)
    expect(res.status).not.toBe(401)
    expect(res.status).toBe(201)
  })
})
