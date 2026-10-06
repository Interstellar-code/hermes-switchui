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

async function post(body: unknown, runId = 'r1') {
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
    params: { runId },
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

  const ok = { node_run_id: 'n1', decision: 'approved' }

  it('400 on invalid run id or node_run_id', async () => {
    expect((await post(ok, '../x')).status).toBe(400)
    expect((await post({ ...ok, node_run_id: 'a/b' })).status).toBe(400)
    expect(mockApprove).not.toHaveBeenCalled()
  })

  it.each([
    [404, 404, 'Run not found'],
    [400, 400, 'Invalid approval request'],
    [500, 502, 'Failed to approve'],
  ])(
    'maps plugin %i to %i without leaking plugin text',
    async (up, out, msg) => {
      mockApprove.mockRejectedValue(
        new Error(`PluginClient POST /runs/r1/approve: ${up} secret-detail`),
      )
      const res = await post(ok)
      expect(res.status).toBe(out)
      const text = await res.text()
      expect(text).toContain(msg)
      expect(text).not.toContain('secret-detail')
    },
  )

  it('502 on a non-plugin error', async () => {
    mockApprove.mockRejectedValue(new Error('boom'))
    expect((await post(ok)).status).toBe(502)
  })
})
