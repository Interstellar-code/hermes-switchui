/**
 * POST /api/workflow-definitions — source/scope passthrough (QA1 F5-2).
 *
 * The create wizard's "User · only you" scope sends `source: "user"`. The
 * route validated the enum but dropped it, so every user save was stored by
 * the engine as its own default (project). The proxy must forward the chosen
 * source to the engine.
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
  id: 'wf-scope-1',
  name: 'Scoped Flow',
  yaml: 'name: Scoped Flow\nnodes:\n  - id: n1\n    prompt: hi\n',
}

describe('POST /api/workflow-definitions — source/scope passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(null)
    mockUpsertDefinition.mockResolvedValue({ id: 'wf-scope-1' })
  })

  it('forwards source "user" to the engine (QA1 F5-2)', async () => {
    const handler = await getPostHandler()
    const res = await handler({
      request: post({ ...VALID_BODY, source: 'user' }),
    })

    expect(res.status).toBe(200)
    expect(mockUpsertDefinition).toHaveBeenCalledTimes(1)
    const opts = mockUpsertDefinition.mock.calls[0][2] as Record<
      string,
      unknown
    >
    expect(opts.source).toBe('user')
  })

  it('forwards source "project" to the engine when chosen explicitly', async () => {
    const handler = await getPostHandler()
    const res = await handler({
      request: post({ ...VALID_BODY, source: 'project' }),
    })

    expect(res.status).toBe(200)
    const opts = mockUpsertDefinition.mock.calls[0][2] as Record<
      string,
      unknown
    >
    expect(opts.source).toBe('project')
  })

  it('defaults to the engine default (project) when the body has no source', async () => {
    const handler = await getPostHandler()
    const res = await handler({ request: post(VALID_BODY) })

    expect(res.status).toBe(200)
    const opts = mockUpsertDefinition.mock.calls[0][2] as Record<
      string,
      unknown
    >
    expect('source' in opts).toBe(false)
  })

  it('rejects an invalid source with 400 before reaching the engine', async () => {
    const handler = await getPostHandler()
    const res = await handler({
      request: post({ ...VALID_BODY, source: 'factory' }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("source must be 'project' | 'user' | 'bundled'")
    expect(mockUpsertDefinition).not.toHaveBeenCalled()
  })
})
