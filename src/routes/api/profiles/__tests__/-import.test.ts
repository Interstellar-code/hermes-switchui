import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── fs mock ──────────────────────────────────────────────────────────────────
const { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } = vi.hoisted(
  () => ({
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn().mockImplementation(() => {}),
    mkdirSync: vi.fn().mockImplementation(() => {}),
    readdirSync: vi.fn().mockReturnValue([]),
    statSync: vi.fn().mockReturnValue({ isFile: () => false, isDirectory: () => false, size: 0 }),
  }),
)

vi.mock('node:fs', () => ({
  default: { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync },
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))

vi.mock('../../../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

vi.mock('../../../../server/rate-limit', () => ({
  requireJsonContentType: () => null,
}))

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/profiles/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function getHandler() {
  vi.resetModules()
  const mod = await import('../import')
  return (
    mod as unknown as {
      Route: {
        server: { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } }
      }
    }
  ).Route.server.handlers.POST
}

function validBundle(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    name: 'imported-agent',
    config: { description: 'Imported' },
    skills: {},
    ...overrides,
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/profiles/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existsSync.mockReturnValue(false)
    readFileSync.mockReturnValue('')
    readdirSync.mockReturnValue([])
  })

  it('400s when bundle is missing', async () => {
    const handler = await getHandler()
    const res = await handler({ request: makeRequest({}) })
    expect(res.status).toBe(400)
  })

  it('400s on an unsupported schema version', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({ bundle: validBundle({ schemaVersion: 99 }) }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Unsupported profile bundle schema version')
  })

  it('400s on an invalid profile name', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({ bundle: validBundle({ name: 'Bad Name!!' }) }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Invalid profile name')
  })

  it('409s on a name collision', async () => {
    existsSync.mockReturnValue(true)
    const handler = await getHandler()
    const res = await handler({ request: makeRequest({ bundle: validBundle() }) })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Profile already exists')
  })

  it('400s on a path-traversal skills key', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({
        bundle: validBundle({ skills: { '../../etc/passwd': 'pwned' } }),
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/Invalid skills path/)
  })

  it('imports successfully and normalises agent_ui', async () => {
    // false for the pre-creation collision check; true afterwards so the
    // final readProfile() (which re-checks existence) succeeds.
    let created = false
    existsSync.mockImplementation(() => created)
    writeFileSync.mockImplementation(() => {
      created = true
    })
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({
        bundle: validBundle({
          config: { description: 'Imported', agent_ui: { tier: 1, status: 'active' } },
        }),
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; profile: { config: Record<string, unknown> } }
    expect(body.ok).toBe(true)
    expect(writeFileSync).toHaveBeenCalled()
  })
})
