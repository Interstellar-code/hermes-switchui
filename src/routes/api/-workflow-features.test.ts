import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIsAuthenticated = vi.fn()
const mockHealth = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))
vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: (...a: Array<unknown>) => mockIsAuthenticated(...a),
}))
vi.mock('../../server/workflow-engine/factory', () => ({
  getEngine: () => ({ health: (...a: Array<unknown>) => mockHealth(...a) }),
}))

async function get() {
  const mod = await import('./workflow-features')
  const GET = (
    mod as unknown as {
      Route: {
        server: {
          handlers: { GET: (c: { request: Request }) => Promise<Response> }
        }
      }
    }
  ).Route.server.handlers.GET
  return GET({ request: new Request('http://x/api/workflow-features') })
}

describe('GET /api/workflow-features', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
  })

  it('401 without auth', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    expect((await get()).status).toBe(401)
  })

  it('returns features, scheduler and profile', async () => {
    mockHealth.mockResolvedValue({
      ok: true,
      features: ['retry_run'],
      scheduler_alive: true,
      profile: 'p',
    })
    expect(await (await get()).json()).toEqual({
      features: ['retry_run'],
      schedulerAlive: true,
      profile: 'p',
    })
  })

  it('degrades to [] when features are missing or health fails', async () => {
    mockHealth.mockResolvedValueOnce({ ok: true })
    expect(
      ((await (await get()).json()) as { features: Array<string> }).features,
    ).toEqual([])
    mockHealth.mockRejectedValueOnce(new Error('down'))
    expect(await (await get()).json()).toEqual({
      features: [],
      schedulerAlive: false,
      profile: null,
    })
  })
})
