import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIsAuthenticated = vi.fn()
const mockListRunEvents = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))
vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: (...a: Array<unknown>) => mockIsAuthenticated(...a),
}))
vi.mock('../../server/workflow-engine/factory', () => ({
  getEngine: () => ({
    listRunEvents: (...a: Array<unknown>) => mockListRunEvents(...a),
  }),
}))

async function get(qs = '') {
  const mod = await import('./workflow-runs.$runId.events')
  const GET = (
    mod as unknown as {
      Route: {
        server: {
          handlers: {
            GET: (c: {
              request: Request
              params: { runId: string }
            }) => Promise<Response>
          }
        }
      }
    }
  ).Route.server.handlers.GET
  return GET({
    request: new Request(`http://x/api/workflow-runs/r1/events${qs}`),
    params: { runId: 'r1' },
  })
}

describe('GET /api/workflow-runs/:runId/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
  })

  it('401 without auth', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    expect((await get()).status).toBe(401)
    expect(mockListRunEvents).not.toHaveBeenCalled()
  })

  it('passes filters through and clamps limit to 1000', async () => {
    mockListRunEvents.mockResolvedValue({ events: [], cursor: null })
    const res = await get('?limit=99999&node_run_id=n1&type=node_log&after=c5')
    expect(res.status).toBe(200)
    expect(mockListRunEvents).toHaveBeenCalledWith('r1', {
      limit: 1000,
      node_run_id: 'n1',
      type: 'node_log',
      after: 'c5',
    })
  })

  it('passes 404 through', async () => {
    mockListRunEvents.mockRejectedValue(new Error('PluginClient GET x: 404 nf'))
    expect((await get()).status).toBe(404)
  })

  it('500 on other engine errors', async () => {
    mockListRunEvents.mockRejectedValue(new Error('boom'))
    expect((await get()).status).toBe(500)
  })
})
