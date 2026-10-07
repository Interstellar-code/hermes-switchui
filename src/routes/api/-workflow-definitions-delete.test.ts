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

  it('passes through 409 conflict verbatim when the engine refuses delete', async () => {
    const err = Object.assign(
      new Error('Cannot delete workflow with active runs'),
      { status: 409 },
    )
    engine.deleteWorkflowDefinition.mockRejectedValue(err)
    const res = await del('wf')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Cannot delete workflow with active runs',
    })
  })

  it('rethrows other failures', async () => {
    engine.deleteWorkflowDefinition.mockRejectedValue(new Error('boom'))
    await expect(del('wf')).rejects.toThrow('boom')
  })
})
