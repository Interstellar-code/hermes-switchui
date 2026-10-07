/**
 * POST /api/workflow-definitions — if_absent passthrough (create-only guard).
 *
 * The create wizard sends `if_absent: true` when the engine lists the
 * `create_only` feature. The proxy must validate it as a boolean, forward it
 * only when true, and pass the engine's 409 `{error, code:'id_taken'}` through.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIsAuthenticated = vi.fn()
const mockRequireJsonContentType = vi.fn()
const mockUpsertDefinition = vi.fn()

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
    upsertDefinition: (...args: Array<unknown>) =>
      mockUpsertDefinition(...args),
  }),
}))

async function getPostHandler() {
  const mod = await import('./workflow-definitions')
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

function post(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/workflow-definitions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID_BODY = {
  id: 'wf-new-1',
  name: 'New Flow',
  yaml: 'name: New Flow\nnodes:\n  - id: n1\n    prompt: hi\n',
}

// Same shape PluginClient throws (WorkflowConflictError): status 409, raw engine body as message.
function conflict(message: string): Error {
  return Object.assign(new Error(message), { status: 409 })
}

function engineOpts(): Record<string, unknown> {
  return mockUpsertDefinition.mock.calls[0][2] as Record<string, unknown>
}

describe('POST /api/workflow-definitions — if_absent passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(null)
    mockUpsertDefinition.mockResolvedValue({ id: 'wf-new-1' })
  })

  it('forwards if_absent: true to the engine', async () => {
    const handler = await getPostHandler()
    const res = await handler({
      request: post({ ...VALID_BODY, if_absent: true }),
    })

    expect(res.status).toBe(200)
    expect(mockUpsertDefinition).toHaveBeenCalledTimes(1)
    expect(engineOpts().if_absent).toBe(true)
  })

  it('omits if_absent when false', async () => {
    const handler = await getPostHandler()
    const res = await handler({
      request: post({ ...VALID_BODY, if_absent: false }),
    })

    expect(res.status).toBe(200)
    expect('if_absent' in engineOpts()).toBe(false)
  })

  it('omits if_absent when the body has none', async () => {
    const handler = await getPostHandler()
    const res = await handler({ request: post(VALID_BODY) })

    expect(res.status).toBe(200)
    expect('if_absent' in engineOpts()).toBe(false)
  })

  it('rejects a non-boolean if_absent with 400 before reaching the engine', async () => {
    const handler = await getPostHandler()
    const res = await handler({
      request: post({ ...VALID_BODY, if_absent: 'yes' }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('if_absent must be a boolean when provided')
    expect(mockUpsertDefinition).not.toHaveBeenCalled()
  })

  it('maps the engine 409 id_taken to a 409 carrying {error, code}', async () => {
    mockUpsertDefinition.mockRejectedValue(
      conflict(
        JSON.stringify({
          error: "definition 'wf-new-1' already exists",
          code: 'id_taken',
        }),
      ),
    )
    const handler = await getPostHandler()
    const res = await handler({
      request: post({ ...VALID_BODY, if_absent: true }),
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: "definition 'wf-new-1' already exists",
      code: 'id_taken',
    })
  })

  it('keeps a plain-text 409 as {error} without a code', async () => {
    mockUpsertDefinition.mockRejectedValue(
      conflict('Conflict: checksum mismatch'),
    )
    const handler = await getPostHandler()
    const res = await handler({ request: post(VALID_BODY) })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Conflict: checksum mismatch' })
  })
})
