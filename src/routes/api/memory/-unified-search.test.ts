import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './unified-search'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: unknown) => ({ options }),
}))

const m = vi.hoisted(() => ({
  isAuthenticated: vi.fn(),
  isMemoryProfile: vi.fn(),
  searchMemoryFiles: vi.fn(),
  searchKnowledgePages: vi.fn(),
  searchMnemosyne: vi.fn(),
}))
vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: m.isAuthenticated,
}))
vi.mock('../../../server/memory-profile', () => ({
  isMemoryProfile: m.isMemoryProfile,
}))
vi.mock('../../../server/memory-browser', () => ({
  searchMemoryFiles: m.searchMemoryFiles,
}))
vi.mock('../../../server/knowledge-browser', () => ({
  searchKnowledgePages: m.searchKnowledgePages,
}))
vi.mock('../../../server/mnemosyne-browser', () => ({
  searchMnemosyne: m.searchMnemosyne,
}))

type GetHandler = (context: { request: Request }) => Response
const get = (
  Route as unknown as { options: { server: { handlers: { GET: GetHandler } } } }
).options.server.handlers.GET

const call = (qs: string) =>
  get({
    request: new Request(`http://localhost/api/memory/unified-search?${qs}`),
  })

describe('/api/memory/unified-search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.isAuthenticated.mockReturnValue(true)
    m.isMemoryProfile.mockImplementation((p: string) => p === 'hermes-switch')
    m.searchMemoryFiles.mockReturnValue([
      { path: 'memories/MEMORY.md', line: 3, text: 'switchui' },
    ])
    m.searchKnowledgePages.mockReturnValue(
      Array.from({ length: 20 }, (_, i) => ({
        path: `p${i}.md`,
        title: `P${i}`,
        line: 1,
        text: '',
      })),
    )
    m.searchMnemosyne.mockReturnValue([
      { kind: 'gist', text: 'switchui gist', score: 1 },
    ])
  })

  it('401 when unauthenticated, no searches run', () => {
    m.isAuthenticated.mockReturnValue(false)
    expect(call('q=x').status).toBe(401)
    expect(m.searchMemoryFiles).not.toHaveBeenCalled()
    expect(m.searchMnemosyne).not.toHaveBeenCalled()
  })

  it('400 for an unknown profile', () => {
    expect(call('q=x&profile=..%2Fetc').status).toBe(400)
    expect(m.searchKnowledgePages).not.toHaveBeenCalled()
  })

  it('400 when q is longer than 500 chars', () => {
    expect(call(`q=${'a'.repeat(501)}`).status).toBe(400)
  })

  it('returns results grouped by source, capped per group, profile-scoped', async () => {
    const res = call('q=switchui&profile=hermes-switch')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agentFiles).toEqual([
      { path: 'memories/MEMORY.md', line: 3, text: 'switchui' },
    ])
    expect(body.wiki).toHaveLength(8)
    expect(body.memories).toEqual([
      { kind: 'gist', text: 'switchui gist', score: 1 },
    ])
    expect(body.failed).toEqual([])
    expect(m.searchKnowledgePages).toHaveBeenCalledWith(
      'switchui',
      'hermes-switch',
    )
    expect(m.searchMnemosyne).toHaveBeenCalledWith(
      'switchui',
      8,
      undefined,
      'hermes-switch',
    )
  })

  it('one failing source empties only its group', async () => {
    m.searchKnowledgePages.mockImplementation(() => {
      throw new Error('Knowledge root is not allowed')
    })
    const body = await call('q=switchui').json()
    expect(body.wiki).toEqual([])
    expect(body.failed).toEqual(['wiki'])
    expect(body.memories).toHaveLength(1)
  })
})
