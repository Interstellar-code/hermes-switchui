import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowRetryError } from '../../server/workflow-engine/clients/plugin-client'

const mockIsAuthenticated = vi.fn()
const mockRetry = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))
vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: (...a: Array<unknown>) => mockIsAuthenticated(...a),
}))
vi.mock('../../server/workflow-engine/factory', () => ({
  getEngine: () => ({ retryRun: (...a: Array<unknown>) => mockRetry(...a) }),
}))

type Handler = (c: {
  request: Request
  params: { runId: string }
}) => Promise<Response>

async function post(
  body: unknown,
  runId = 'r1',
  contentType = 'application/json',
) {
  const mod = (await import('./workflow-runs.$runId.retry')) as unknown as {
    Route: { server: { handlers: { POST: Handler } } }
  }
  return mod.Route.server.handlers.POST({
    request: new Request(`http://x/api/workflow-runs/${runId}/retry`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: JSON.stringify(body),
    }),
    params: { runId },
  })
}

describe('POST /api/workflow-runs/:runId/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
    mockRetry.mockResolvedValue({ id: 'r1', status: 'running' })
  })

  it('401 before anything else', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    expect((await post({})).status).toBe(401)
    expect(mockRetry).not.toHaveBeenCalled()
  })

  it('415 without a JSON content type', async () => {
    expect((await post({}, 'r1', 'text/plain')).status).toBe(415)
  })

  it('sets actor server-side and forwards from_node_id', async () => {
    const res = await post({ from_node_id: 'apply', actor: 'mallory' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ run: { id: 'r1', status: 'running' } })
    expect(mockRetry).toHaveBeenCalledWith('r1', {
      from_node_id: 'apply',
      actor: 'switchui',
    })
  })

  it('rejects bad ids before calling the plugin', async () => {
    expect((await post({}, '..')).status).toBe(400)
    expect((await post({ from_node_id: 'a/b' })).status).toBe(400)
    expect(mockRetry).not.toHaveBeenCalled()
  })

  it.each([
    ['run still owned by a live process', 'live_owner'],
    ['run already retried', 'already_retried'],
    [
      'run is completed; only failed, cancelled or crashed runs can be retried',
      'not_retryable',
    ],
  ])('409 %s → code %s', async (msg, code) => {
    mockRetry.mockRejectedValue(new WorkflowRetryError(409, msg))
    const res = await post({})
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe(code)
  })

  it('maps 404 and unknown failures to generic errors', async () => {
    mockRetry.mockRejectedValueOnce(new WorkflowRetryError(404, 'x'))
    expect((await post({})).status).toBe(404)
    mockRetry.mockRejectedValueOnce(new Error('boom /secret/path'))
    const res = await post({})
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Failed to retry run' })
  })
})
