import { beforeEach, describe, expect, it, vi } from 'vitest'

const engine = {
  getDefinition: vi.fn(),
  deleteWorkflowDefinition: vi.fn(),
  listRuns: vi.fn(),
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))
vi.mock('../../server/auth-middleware', () => ({ isAuthenticated: () => true }))
vi.mock('../../server/rate-limit', () => ({
  requireJsonContentType: () => null,
}))
vi.mock('../../server/workflow-engine/factory', () => ({
  getEngine: () => engine,
}))

async function del(id: string) {
  const mod = (await import('./workflow-definitions.$id')) as unknown as {
    Route: {
      server: {
        handlers: {
          DELETE: (a: {
            request: Request
            params: { id: string }
          }) => Promise<Response>
        }
      }
    }
  }
  return mod.Route.server.handlers.DELETE({
    request: new Request('http://x', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
    }),
    params: { id },
  })
}

describe('DELETE /api/workflow-definitions/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    engine.getDefinition.mockResolvedValue({ id: 'wf', source: 'user' })
  })

  it('deletes a definition without runs', async () => {
    engine.deleteWorkflowDefinition.mockResolvedValue(1)
    expect((await del('wf')).status).toBe(200)
  })

  it('returns 409 with a clear reason when run history blocks the delete', async () => {
    engine.deleteWorkflowDefinition.mockRejectedValue(new Error('DELETE: 500'))
    engine.listRuns.mockResolvedValue([{ id: 'r1' }])
    const res = await del('wf')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/run history/)
  })

  it('rethrows other failures', async () => {
    engine.deleteWorkflowDefinition.mockRejectedValue(new Error('boom'))
    engine.listRuns.mockResolvedValue([])
    await expect(del('wf')).rejects.toThrow('boom')
  })
})
