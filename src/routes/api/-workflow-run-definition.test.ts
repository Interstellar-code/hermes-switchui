import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIsAuthenticated = vi.fn()
const mockDashboardFetch = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))
vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: (...a: Array<unknown>) => mockIsAuthenticated(...a),
}))
vi.mock('../../server/gateway-capabilities', () => ({
  dashboardFetch: (...a: Array<unknown>) => mockDashboardFetch(...a),
}))

async function get() {
  const mod = await import('./workflow-runs.$runId.definition')
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
    request: new Request('http://x/api/workflow-runs/r1/definition'),
    params: { runId: 'r1' },
  })
}

describe('GET /api/workflow-runs/:runId/definition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
  })

  it('401 without auth', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    expect((await get()).status).toBe(401)
    expect(mockDashboardFetch).not.toHaveBeenCalled()
  })

  it('404 from the plugin degrades to available:false', async () => {
    mockDashboardFetch.mockResolvedValue(new Response('nf', { status: 404 }))
    expect(await (await get()).json()).toEqual({ available: false })
  })

  it('proxies the plugin payload', async () => {
    mockDashboardFetch.mockResolvedValue(
      Response.json({ definition: { yaml: 'a: 1' }, parsed: {} }),
    )
    expect(mockDashboardFetch).not.toHaveBeenCalled()
    const body = (await (await get()).json()) as Record<string, unknown>
    expect(body.available).toBe(true)
    expect(mockDashboardFetch.mock.calls[0][0]).toBe(
      '/api/plugins/workflow-engine/runs/r1/definition',
    )
  })

  it('re-projects parsed from the pinned yaml (with depends_on)', async () => {
    mockDashboardFetch.mockResolvedValue(
      Response.json({
        definition: {
          workflow_id: 'wf',
          yaml: 'nodes:\n  - id: a\n    bash: echo\n  - id: b\n    depends_on: [a]\n    prompt: hi\n',
        },
        parsed: { id: 'wf', nodes: [{ id: 'a', type: 'bash' }] },
      }),
    )
    const body = (await (await get()).json()) as {
      parsed: { edges: Array<[string, string]>; nodes: Array<{ id: string }> }
    }
    expect(body.parsed.edges).toEqual([['a', 'b']])
    expect(body.parsed.nodes.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('parsed is null when the pinned yaml does not parse', async () => {
    mockDashboardFetch.mockResolvedValue(
      Response.json({ definition: { yaml: 'a: [' }, parsed: {} }),
    )
    expect(((await (await get()).json()) as { parsed: unknown }).parsed).toBe(
      null,
    )
  })

  it('502 on plugin failure', async () => {
    mockDashboardFetch.mockRejectedValue(new Error('down'))
    expect((await get()).status).toBe(502)
  })
})
