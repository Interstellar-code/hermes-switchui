/**
 * Focused regression tests for workflow-runs API route guards.
 *
 * #157 — POST /api/workflow-runs: malformed body → 400 (not an unhandled throw)
 * #159 — POST /api/workflow-runs/:runId: unauthenticated → 401, NOT 415 (auth before CSRF)
 * #162 — POST /api/workflow-runs/:runId?action=cancel|resume: engine throws → 500 JSON
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Top-level mocks (hoisted by Vitest)
// ---------------------------------------------------------------------------

const mockIsAuthenticated = vi.fn()
const mockRequireJsonContentType = vi.fn()
const mockCancelRun = vi.fn()
const mockResumeWorkflowRun = vi.fn()
const mockStartRun = vi.fn()

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
    listRuns: vi.fn(),
    startRun: (...args: Array<unknown>) => mockStartRun(...args),
    getRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' }),
    listNodeRuns: vi.fn().mockResolvedValue([]),
    listPhaseTransitions: vi.fn().mockResolvedValue([]),
    listRecentWorkflowEvents: vi.fn().mockResolvedValue([]),
    cancelRun: (...args: Array<unknown>) => mockCancelRun(...args),
    resumeWorkflowRun: (...args: Array<unknown>) => mockResumeWorkflowRun(...args),
    recordPhaseTransition: vi.fn(),
  }),
}))

vi.mock('../../server/workflow-engine/interface', () => ({
  VALID_TRANSITIONS: { planning: true, running: true, paused: true },
}))

// ---------------------------------------------------------------------------
// Handler loader helpers (import after mocks are in place)
// ---------------------------------------------------------------------------

async function getRunsPostHandler() {
  const mod = await import('./workflow-runs')
  return (mod as unknown as {
    Route: { server: { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } } }
  }).Route.server.handlers.POST
}

async function getRunIdPostHandler() {
  const mod = await import('./workflow-runs.$runId')
  return (mod as unknown as {
    Route: {
      server: {
        handlers: {
          POST: (ctx: { request: Request; params: { runId: string } }) => Promise<Response>
        }
      }
    }
  }).Route.server.handlers.POST
}

// ---------------------------------------------------------------------------
// #157 — workflow-runs.ts POST: malformed JSON body → 400
// ---------------------------------------------------------------------------

describe('#157 POST /api/workflow-runs — malformed body returns 400', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
    // CSRF guard passes (returns null = no error response)
    mockRequireJsonContentType.mockReturnValue(null)
  })

  it('returns 400 { error: "Invalid JSON body" } when body is not valid JSON', async () => {
    const handler = await getRunsPostHandler()
    const request = new Request('http://localhost/api/workflow-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'this is { not json',
    })
    const res = await handler({ request })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Invalid JSON body')
  })

  it('returns 400 { error: "Invalid JSON body" } when body is empty string', async () => {
    const handler = await getRunsPostHandler()
    const request = new Request('http://localhost/api/workflow-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    })
    const res = await handler({ request })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Invalid JSON body')
  })
})

// ---------------------------------------------------------------------------
// #159 — workflow-runs.$runId.ts POST: auth runs BEFORE CSRF
// ---------------------------------------------------------------------------

describe('#159 POST /api/workflow-runs/:runId — auth runs before CSRF', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // CSRF guard returns a 415 when wrong content-type — used to prove ordering
    mockRequireJsonContentType.mockReturnValue(
      Response.json({ error: 'Unsupported Media Type' }, { status: 415 }),
    )
  })

  it('returns 401 (not 415) when caller is unauthenticated, even with wrong Content-Type', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const handler = await getRunIdPostHandler()
    const request = new Request('http://localhost/api/workflow-runs/run-1?action=cancel', {
      method: 'POST',
      // Deliberately wrong content-type — would trigger 415 if CSRF ran first
      headers: { 'content-type': 'text/plain' },
    })
    const res = await handler({ request, params: { runId: 'run-1' } })
    expect(res.status).toBe(401)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 415 when authenticated but wrong Content-Type, proving CSRF runs after auth', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    const handler = await getRunIdPostHandler()
    const request = new Request('http://localhost/api/workflow-runs/run-1?action=cancel', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
    })
    const res = await handler({ request, params: { runId: 'run-1' } })
    // Auth passed → CSRF fired → 415
    expect(res.status).toBe(415)
  })
})

// ---------------------------------------------------------------------------
// #162 — workflow-runs.$runId.ts POST: engine errors → 500 JSON for cancel/resume
// ---------------------------------------------------------------------------

describe('#162 POST /api/workflow-runs/:runId — engine errors return 500 JSON', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(null)
  })

  it('returns 500 JSON when cancelRun throws', async () => {
    mockCancelRun.mockRejectedValueOnce(new Error('plugin unavailable'))
    const handler = await getRunIdPostHandler()
    const res = await handler({
      request: new Request('http://localhost/api/workflow-runs/run-1?action=cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
      params: { runId: 'run-1' },
    })
    expect(res.status).toBe(500)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('plugin unavailable')
  })

  it('returns 500 JSON when resumeWorkflowRun throws', async () => {
    mockResumeWorkflowRun.mockRejectedValueOnce(new Error('run not paused'))
    const handler = await getRunIdPostHandler()
    const res = await handler({
      request: new Request('http://localhost/api/workflow-runs/run-1?action=resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
      params: { runId: 'run-1' },
    })
    expect(res.status).toBe(500)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('run not paused')
  })

  it('happy path: cancelRun succeeds → 200 { ok: true }', async () => {
    mockCancelRun.mockResolvedValueOnce(undefined)
    const handler = await getRunIdPostHandler()
    const res = await handler({
      request: new Request('http://localhost/api/workflow-runs/run-1?action=cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
      params: { runId: 'run-1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('happy path: resumeWorkflowRun succeeds → 200 { ok: true }', async () => {
    mockResumeWorkflowRun.mockResolvedValueOnce(undefined)
    const handler = await getRunIdPostHandler()
    const res = await handler({
      request: new Request('http://localhost/api/workflow-runs/run-1?action=resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
      params: { runId: 'run-1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
