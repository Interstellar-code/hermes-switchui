import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── fs mock ──────────────────────────────────────────────────────────────────
const { existsSync, readFileSync, readdirSync, statSync } = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(''),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ isFile: () => false, isDirectory: () => false, size: 0 }),
}))

vi.mock('node:fs', () => ({
  default: { existsSync, readFileSync, readdirSync, statSync },
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))

vi.mock('../../../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRequest(query: string): Request {
  return new Request(`http://localhost/api/profiles/export${query}`, { method: 'GET' })
}

async function getHandler() {
  vi.resetModules()
  const mod = await import('../export')
  return (
    mod as unknown as {
      Route: { server: { handlers: { GET: (ctx: { request: Request }) => Response } } }
    }
  ).Route.server.handlers.GET
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/profiles/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existsSync.mockReturnValue(false)
    readFileSync.mockReturnValue('')
    readdirSync.mockReturnValue([])
  })

  it('400s when name is missing', async () => {
    const handler = await getHandler()
    const res = await handler({ request: makeRequest('') })
    expect(res.status).toBe(400)
  })

  it('404s for a profile that does not exist', async () => {
    existsSync.mockReturnValue(false)
    const handler = await getHandler()
    const res = await handler({ request: makeRequest('?name=ghost') })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Profile not found')
  })

  it('exports an existing profile as a bundle', async () => {
    existsSync.mockReturnValue(true)
    readFileSync.mockReturnValue('description: An agent\nmodel:\n  default: auto\n')
    readdirSync.mockReturnValue([])
    const handler = await getHandler()
    const res = await handler({ request: makeRequest('?name=myprofile') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      schemaVersion: number
      name: string
      config: Record<string, unknown>
      skills: Record<string, string>
    }
    expect(body.schemaVersion).toBe(1)
    expect(body.name).toBe('myprofile')
    expect(body.config.description).toBe('An agent')
    expect(body.skills).toEqual({})
  })
})
