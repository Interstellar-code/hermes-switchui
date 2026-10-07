/**
 * POST /api/workflow-definitions — save_source passthrough (F5).
 *
 * The Import-YAML path of the create wizard sends `save_source: "import"`;
 * normal saves omit it (or send "save"). The proxy must validate the enum
 * and forward it to the engine untouched.
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
  id: 'wf-import-1',
  name: 'Imported Flow',
  yaml: 'name: Imported Flow\nnodes:\n  - id: n1\n    prompt: hi\n',
}

describe('POST /api/workflow-definitions — save_source passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
    mockRequireJsonContentType.mockReturnValue(null)
    mockUpsertDefinition.mockResolvedValue({ id: 'wf-import-1' })
  })

  it('forwards save_source "import" to the engine', async () => {
    const handler = await getPostHandler()
    const res = await handler({
      request: post({ ...VALID_BODY, save_source: 'import' }),
    })

    expect(res.status).toBe(200)
    expect(mockUpsertDefinition).toHaveBeenCalledTimes(1)
    const opts = mockUpsertDefinition.mock.calls[0][2] as Record<
      string,
      unknown
    >
    expect(opts.save_source).toBe('import')
  })

  it('forwards save_source "save" to the engine', async () => {
    const handler = await getPostHandler()
    const res = await handler({
      request: post({ ...VALID_BODY, save_source: 'save' }),
    })

    expect(res.status).toBe(200)
    const opts = mockUpsertDefinition.mock.calls[0][2] as Record<
      string,
      unknown
    >
    expect(opts.save_source).toBe('save')
  })

  it('omits save_source from engine opts when the body has none', async () => {
    const handler = await getPostHandler()
    const res = await handler({ request: post(VALID_BODY) })

    expect(res.status).toBe(200)
    const opts = mockUpsertDefinition.mock.calls[0][2] as Record<
      string,
      unknown
    >
    expect('save_source' in opts).toBe(false)
  })

  it('rejects any other save_source value with 400 before reaching the engine', async () => {
    const handler = await getPostHandler()
    const res = await handler({
      request: post({ ...VALID_BODY, save_source: 'template' }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe(
      "save_source must be 'save' | 'import' when provided",
    )
    expect(mockUpsertDefinition).not.toHaveBeenCalled()
  })
})
