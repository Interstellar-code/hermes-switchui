/**
 * POST /api/workflow-definitions/validate — route tests (FIX1).
 * Mocks only the engine (getEngine); asserts the report passthrough,
 * 413 for oversized yaml, 400 on a bad id, 503 engine-down shape.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowPayloadTooLargeError } from '../../server/workflow-engine/clients/plugin-client'

const mockIsAuthenticated = vi.fn()
const mockRequireJsonContentType = vi.fn()
const mockValidateDefinition = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: (...args: Array<unknown>) => mockIsAuthenticated(...args),
}))

vi.mock('../../server/rate-limit', () => ({
  requireJsonContentType: (...args: Array<unknown>) =>
    mockRequireJsonContentType(...args),
}))

vi.mock('../../server/workflow-engine/factory', () => ({
  getEngine: () => ({
    validateDefinition: (...args: Array<unknown>) =>
      mockValidateDefinition(...args),
  }),
}))

async function getPostHandler() {
  const mod = await import('./workflow-definitions.validate')
  return (
    mod as unknown as {
      Route: {
        server: {
          handlers: {
            POST: (ctx: { request: Request }) => Promise<Response>
          }
        }
      }
    }
  ).Route.server.handlers.POST
}

function post(body: unknown): Request {
  return new Request('http://localhost/api/workflow-definitions/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const REPORT = {
  ok: false,
  errors: [
    {
      line: 6,
      col: 18,
      code: 'unknown_dependency',
      message: "node 'a' depends on unknown node 'ghost'",
      node_id: 'a',
    },
    {
      line: null,
      col: null,
      code: 'cycle',
      message: 'cycle: a -> b -> a',
      node_id: 'a',
    },
  ],
  warnings: [],
  id_available: true,
}

describe('POST /api/workflow-definitions/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(null)
  })

  it('returns the engine report, including null line/col issues', async () => {
    mockValidateDefinition.mockResolvedValue(REPORT)
    const handler = await getPostHandler()
    const res = await handler({
      request: post({ yaml: 'name: x\nnodes: []\n', id: 'my-wf' }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(REPORT)
    expect(mockValidateDefinition).toHaveBeenCalledWith(
      'name: x\nnodes: []\n',
      'my-wf',
    )
  })

  it('calls the engine without an id when none is supplied', async () => {
    mockValidateDefinition.mockResolvedValue({ ...REPORT, id_available: null })
    const handler = await getPostHandler()
    await handler({ request: post({ yaml: 'nodes: []\n' }) })

    expect(mockValidateDefinition).toHaveBeenCalledWith(
      'nodes: []\n',
      undefined,
    )
  })

  it('forwards an empty yaml string (the engine answers with a schema error)', async () => {
    mockValidateDefinition.mockResolvedValue({
      ok: false,
      errors: [{ line: null, col: null, code: 'schema', message: 'empty' }],
      warnings: [],
      id_available: null,
    })
    const handler = await getPostHandler()
    const res = await handler({ request: post({ yaml: '' }) })

    expect(res.status).toBe(200)
    expect(mockValidateDefinition).toHaveBeenCalled()
  })

  it('returns 413 before the engine when yaml exceeds 1 MiB', async () => {
    const handler = await getPostHandler()
    const res = await handler({
      request: post({ yaml: 'x'.repeat(1024 * 1024 + 1) }),
    })

    expect(res.status).toBe(413)
    expect(mockValidateDefinition).not.toHaveBeenCalled()
  })

  it('returns 400 on a non-string yaml', async () => {
    const handler = await getPostHandler()
    const res = await handler({ request: post({ yaml: 42 }) })

    expect(res.status).toBe(400)
    expect(mockValidateDefinition).not.toHaveBeenCalled()
  })

  it('returns 400 on an id that fails WORKFLOW_ID_RE', async () => {
    const handler = await getPostHandler()
    const res = await handler({
      request: post({ yaml: 'nodes: []\n', id: 'bad id!' }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('[A-Za-z0-9_:.-]')
    expect(mockValidateDefinition).not.toHaveBeenCalled()
  })

  it('maps a plugin 413 to an HTTP 413', async () => {
    mockValidateDefinition.mockRejectedValue(
      new WorkflowPayloadTooLargeError('yaml exceeds the size limit'),
    )
    const handler = await getPostHandler()
    const res = await handler({ request: post({ yaml: 'nodes: []\n' }) })

    expect(res.status).toBe(413)
  })

  it('returns 503 engine_ok:false when the engine throws', async () => {
    mockValidateDefinition.mockRejectedValue(new Error('dashboard down'))
    const handler = await getPostHandler()
    const res = await handler({ request: post({ yaml: 'nodes: []\n' }) })

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      engine_ok: false,
      error: 'Workflow engine unavailable',
    })
  })
})
