/**
 * CSRF guard tests for POST /api/workflow-definitions/:id/reset-factory (#158).
 *
 * Guard order for workflow-definitions routes (matches workflow-definitions.ts sibling):
 *   auth first → CSRF second
 *   So: unauth + wrong Content-Type → 401 (auth fires before CSRF)
 *       auth  + wrong Content-Type  → 415
 *       auth  + correct Content-Type → reaches handler
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Top-level mocks (hoisted by Vitest)
// ---------------------------------------------------------------------------

const mockIsAuthenticated = vi.fn()
const mockRequireJsonContentType = vi.fn()
const mockResetFactoryDefinition = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: (...args: Array<unknown>) => mockIsAuthenticated(...args),
}))

vi.mock('../../server/rate-limit', () => ({
  requireJsonContentType: (...args: Array<unknown>) => mockRequireJsonContentType(...args),
}))

vi.mock('../../server/workflow-engine/factory', () => ({
  getEngine: () => ({
    resetFactoryDefinition: (...args: Array<unknown>) => mockResetFactoryDefinition(...args),
  }),
}))

// ---------------------------------------------------------------------------
// Handler loader helper
// ---------------------------------------------------------------------------

async function getResetFactoryPostHandler() {
  const mod = await import('./workflow-definitions.$id.reset-factory')
  return (mod as unknown as {
    Route: {
      server: {
        handlers: {
          POST: (ctx: { request: Request; params: { id: string } }) => Promise<Response>
        }
      }
    }
  }).Route.server.handlers.POST
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const ROUTE_URL = 'http://localhost/api/workflow-definitions/wf-1/reset-factory'
const PARAMS = { id: 'wf-1' }
const CSRF_415 = Response.json({ error: 'Unsupported Media Type' }, { status: 415 })

function jsonRequest(): Request {
  return new Request(ROUTE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

function plainRequest(): Request {
  return new Request(ROUTE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'form=data',
  })
}

// ---------------------------------------------------------------------------
// POST /api/workflow-definitions/:id/reset-factory — CSRF guard (#158)
// ---------------------------------------------------------------------------

describe('POST /api/workflow-definitions/:id/reset-factory — CSRF guard (#158)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(null) // guard passes by default
  })

  it('returns 401 for unauthenticated POST even with wrong Content-Type (auth fires before CSRF)', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    mockRequireJsonContentType.mockReturnValue(CSRF_415)
    const handler = await getResetFactoryPostHandler()
    const res = await handler({ request: plainRequest(), params: PARAMS })
    // Auth runs first → 401, not 415
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 415 for authenticated POST with wrong Content-Type', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(CSRF_415)
    const handler = await getResetFactoryPostHandler()
    const res = await handler({ request: plainRequest(), params: PARAMS })
    expect(res.status).toBe(415)
  })

  it('reaches handler for authenticated POST with correct Content-Type (not 401 or 415)', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(null)
    mockResetFactoryDefinition.mockResolvedValue({ id: 'wf-1', name: 'Factory Default' })
    const handler = await getResetFactoryPostHandler()
    const res = await handler({ request: jsonRequest(), params: PARAMS })
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(415)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { definition: { id: string } }
    expect(body.definition.id).toBe('wf-1')
  })

  it('returns 404 when resetFactoryDefinition throws a 404 error', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(null)
    mockResetFactoryDefinition.mockRejectedValue({ status: 404, message: 'not found' })
    const handler = await getResetFactoryPostHandler()
    const res = await handler({ request: jsonRequest(), params: PARAMS })
    expect(res.status).toBe(404)
  })
})
