import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIsAuthenticated = vi.fn()
const mockApprove = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))
vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: (...a: Array<unknown>) => mockIsAuthenticated(...a),
}))
vi.mock('../../server/workflow-engine/factory', () => ({
  getEngine: () => ({ approve: (...a: Array<unknown>) => mockApprove(...a) }),
}))

async function post(body: unknown) {
  const mod = await import('./workflow-runs.$runId.approve')
  const POST = (
    mod as unknown as {
      Route: {
        server: {
          handlers: {
            POST: (c: {
              request: Request
              params: { runId: string }
            }) => Promise<Response>
          }
        }
      }
    }
  ).Route.server.handlers.POST
  return POST({
    request: new Request('http://x/api/workflow-runs/r1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params: { runId: 'r1' },
  })
}

describe('POST /api/workflow-runs/:runId/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
  })

  it("sets approved_by to 'switchui' and ignores the client value", async () => {
    const res = await post({
      node_run_id: 'n1',
      decision: 'approved',
      response: 'ok',
      approved_by: 'mallory',
    })
    expect(res.status).toBe(200)
    expect(mockApprove).toHaveBeenCalledWith(
      'r1',
      'n1',
      'approve',
      'ok',
      'switchui',
    )
  })
})
