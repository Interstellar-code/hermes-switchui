/**
 * GET /api/workflow-definitions/:id/versions and .../versions/:checksum —
 * route tests (FIX1). Mocks only the engine; asserts the wrapped payload,
 * 404 passthrough, 400 on a bad id, 503 engine-down shape.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowNotFoundError } from '../../server/workflow-engine/clients/plugin-client'

const mockIsAuthenticated = vi.fn()
const mockListDefinitionVersions = vi.fn()
const mockGetDefinitionVersion = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: (...args: Array<unknown>) => mockIsAuthenticated(...args),
}))

vi.mock('../../server/workflow-engine/factory', () => ({
  getEngine: () => ({
    listDefinitionVersions: (...args: Array<unknown>) =>
      mockListDefinitionVersions(...args),
    getDefinitionVersion: (...args: Array<unknown>) =>
      mockGetDefinitionVersion(...args),
  }),
}))

type Handler = (ctx: {
  request: Request
  params: Record<string, string>
}) => Promise<Response>

async function getHandlers(
  module:
    | './workflow-definitions.$id.versions'
    | './workflow-definitions.$id.versions.$checksum',
): Promise<{ GET: Handler }> {
  const mod = await import(module)
  return (
    mod as unknown as { Route: { server: { handlers: { GET: Handler } } } }
  ).Route.server.handlers
}

const LIST_URL = 'http://localhost/api/workflow-definitions/wf-1/versions'
const ONE_URL =
  'http://localhost/api/workflow-definitions/wf-1/versions/cc11ac2f'

describe('GET /api/workflow-definitions/:id/versions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
  })

  it('wraps the engine list in { versions }', async () => {
    mockListDefinitionVersions.mockResolvedValue([
      {
        checksum: 'cc11ac2f5033',
        version: null,
        saved_at: 1791315040892,
        source: 'save',
        node_count: 2,
        size_bytes: 117,
        in_use_by_runs: 0,
      },
    ])
    const { GET } = await getHandlers('./workflow-definitions.$id.versions')
    const res = await GET({
      request: new Request(LIST_URL),
      params: { id: 'wf-1' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { versions: Array<unknown> }
    expect(body.versions).toHaveLength(1)
    expect(mockListDefinitionVersions).toHaveBeenCalledWith('wf-1')
  })

  it('returns an empty list for a known id with no snapshots', async () => {
    mockListDefinitionVersions.mockResolvedValue([])
    const { GET } = await getHandlers('./workflow-definitions.$id.versions')
    const res = await GET({
      request: new Request(LIST_URL),
      params: { id: 'wf-1' },
    })

    expect(res.status).toBe(200)
    expect(
      ((await res.json()) as { versions: Array<unknown> }).versions,
    ).toEqual([])
  })

  it('passes the engine 404 through for an unknown id', async () => {
    mockListDefinitionVersions.mockRejectedValue(
      new WorkflowNotFoundError('not found'),
    )
    const { GET } = await getHandlers('./workflow-definitions.$id.versions')
    const res = await GET({
      request: new Request(LIST_URL),
      params: { id: 'ghost' },
    })

    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toBe('not found')
  })

  it('returns 400 when the id fails WORKFLOW_ID_RE', async () => {
    const { GET } = await getHandlers('./workflow-definitions.$id.versions')
    const res = await GET({
      request: new Request(LIST_URL),
      params: { id: 'bad id!' },
    })

    expect(res.status).toBe(400)
    expect(mockListDefinitionVersions).not.toHaveBeenCalled()
  })

  it('returns 503 engine_ok:false when the engine throws', async () => {
    mockListDefinitionVersions.mockRejectedValue(new Error('dashboard down'))
    const { GET } = await getHandlers('./workflow-definitions.$id.versions')
    const res = await GET({
      request: new Request(LIST_URL),
      params: { id: 'wf-1' },
    })

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      engine_ok: false,
      error: 'Workflow engine unavailable',
    })
  })
})

describe('GET /api/workflow-definitions/:id/versions/:checksum', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
  })

  it('wraps the engine detail in { version }', async () => {
    mockGetDefinitionVersion.mockResolvedValue({
      checksum: 'cc11ac2f5033',
      version: null,
      saved_at: 1791315040892,
      source: 'import',
      node_count: 1,
      size_bytes: 61,
      in_use_by_runs: 2,
      yaml: 'name: demo\nnodes:\n  - id: a\n    prompt: hi\n',
      parsed: { id: 'demo', nodes: [] },
    })
    const { GET } = await getHandlers(
      './workflow-definitions.$id.versions.$checksum',
    )
    const res = await GET({
      request: new Request(ONE_URL),
      params: { id: 'wf-1', checksum: 'cc11ac2f5033' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { version: { yaml: string } }
    expect(body.version.yaml).toContain('name: demo')
    expect(mockGetDefinitionVersion).toHaveBeenCalledWith(
      'wf-1',
      'cc11ac2f5033',
    )
  })

  it('passes the engine 404 through for an unknown checksum', async () => {
    mockGetDefinitionVersion.mockRejectedValue(
      new WorkflowNotFoundError('not found'),
    )
    const { GET } = await getHandlers(
      './workflow-definitions.$id.versions.$checksum',
    )
    const res = await GET({
      request: new Request(ONE_URL),
      params: { id: 'wf-1', checksum: 'deadbeef' },
    })

    expect(res.status).toBe(404)
  })

  it('returns 503 engine_ok:false when the engine throws', async () => {
    mockGetDefinitionVersion.mockRejectedValue(new Error('dashboard down'))
    const { GET } = await getHandlers(
      './workflow-definitions.$id.versions.$checksum',
    )
    const res = await GET({
      request: new Request(ONE_URL),
      params: { id: 'wf-1', checksum: 'cc11ac2f5033' },
    })

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      engine_ok: false,
      error: 'Workflow engine unavailable',
    })
  })
})
