import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── fs mock ──────────────────────────────────────────────────────────────────
const { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync } =
  vi.hoisted(() => ({
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue('model: auto\n'),
    writeFileSync: vi.fn().mockImplementation(() => {}),
    mkdirSync: vi.fn().mockImplementation(() => {}),
    readdirSync: vi.fn().mockReturnValue([]),
    statSync: vi.fn().mockReturnValue({ isDirectory: () => true, isSymbolicLink: () => false, mtimeMs: 0 }),
    renameSync: vi.fn().mockImplementation(() => {}),
    unlinkSync: vi.fn().mockImplementation(() => {}),
  }))

vi.mock('node:fs', () => ({
  default: { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync },
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  renameSync,
  unlinkSync,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))

vi.mock('@tanstack/react-start', () => ({
  json: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
      ...(init ?? {}),
      headers: { 'Content-Type': 'application/json', ...((init as ResponseInit & { headers?: Record<string, string> })?.headers ?? {}) },
    }),
}))

vi.mock('../../../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

vi.mock('../../../../server/rate-limit', () => ({
  requireJsonContentType: () => null,
}))

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/profiles/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function getHandler() {
  vi.resetModules()
  const mod = await import('../update')
  return (mod as unknown as { Route: { server: { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } } } }).Route
    .server.handlers.POST
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/profiles/update — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existsSync.mockReturnValue(true)
    readFileSync.mockReturnValue('model: auto\n')
  })

  it('rejects agent_ui.tier update with 400', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({ name: 'myprofile', agent_ui: { tier: 3 } }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/tier/)
  })

  it('rejects persona_id set without system_prompt with 400', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({
        name: 'myprofile',
        agent_ui: { persona_id: 'engineering-code-reviewer' },
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/system_prompt/)
  })

  it('allows persona_id: null without system_prompt', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({
        name: 'myprofile',
        agent_ui: { persona_id: null },
      }),
    })
    // persona_id: null clears persona — should not 400
    expect(res.status).not.toBe(400)
  })

  it('accepts legacy { name, patch } envelope', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({
        name: 'myprofile',
        patch: { description: 'Updated via legacy envelope' },
      }),
    })
    // Should not be a 400 validation error (may 200 or 500 depending on fs mock)
    expect(res.status).not.toBe(400)
  })

  it('rejects empty patch (no fields) with 400', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({ name: 'myprofile' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/No fields/)
  })
})
