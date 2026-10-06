import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isAuthenticated } from '../../server/auth-middleware'
import { getEngine } from '../../server/workflow-engine/factory'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/workflow-engine/factory', () => ({
  getEngine: vi.fn(),
}))

const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockGetEngine = vi.mocked(getEngine)

describe('/api/workflow-definitions graceful degradation', () => {
  async function getHandler() {
    vi.resetModules()
    const mod = await import('./workflow-definitions')
    return (mod as any).Route.options.server.handlers.GET
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
  })

  it('returns engine_ok: false and generic error when the plugin engine throws', async () => {
    mockGetEngine.mockReturnValue({
      listDefinitions: vi
        .fn()
        .mockRejectedValue(new Error('Dashboard unavailable')),
    } as any)

    const get = await getHandler()
    const request = new Request('http://localhost/api/workflow-definitions')
    const res = await get({ request })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.definitions).toEqual([])
    expect(json.engine_ok).toBe(false)
    expect(json.error).toBe('Workflow engine unavailable')
  })

  it('returns engine_ok: true and enriched definitions on success', async () => {
    mockGetEngine.mockReturnValue({
      listDefinitions: vi.fn().mockResolvedValue([
        {
          id: 'test-wf',
          name: 'Test Workflow',
          yaml: 'name: Test\nnodes:\n  - id: n1\n    type: approval\n',
        },
      ]),
    } as any)

    const get = await getHandler()
    const request = new Request('http://localhost/api/workflow-definitions')
    const res = await get({ request })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.engine_ok).toBe(true)
    expect(json.definitions).toHaveLength(1)
    expect(json.definitions[0]).toMatchObject({
      id: 'test-wf',
      name: 'Test Workflow',
      has_approval: true,
      node_count: 1,
      node_types: ['approval'],
    })
  })
})

describe('/api/workflow-runs graceful degradation', () => {
  async function getHandler() {
    vi.resetModules()
    const mod = await import('./workflow-runs')
    return (mod as any).Route.options.server.handlers.GET
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
  })

  it('returns empty runs when the plugin engine throws', async () => {
    mockGetEngine.mockReturnValue({
      listRuns: vi.fn().mockRejectedValue(new Error('Dashboard unavailable')),
    } as any)

    const get = await getHandler()
    const request = new Request('http://localhost/api/workflow-runs')
    const res = await get({ request })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.runs).toEqual([])
  })
})
