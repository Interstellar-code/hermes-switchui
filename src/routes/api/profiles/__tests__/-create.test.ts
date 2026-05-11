import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── fs mock ──────────────────────────────────────────────────────────────────
const { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync } =
  vi.hoisted(() => ({
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
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
  return new Request('http://localhost/api/profiles/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function getHandler() {
  vi.resetModules()
  // After resetModules we need the fs mock re-applied; vitest re-applies vi.mock at import time
  const mod = await import('../create')
  return (mod as unknown as { Route: { server: { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } } } }).Route
    .server.handlers.POST
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/profiles/create — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: profile dir does not exist (so createProfile succeeds), config.yaml readable
    existsSync.mockImplementation((p: string) => {
      // profiles root dir exists, but the new profile dir doesn't
      if (typeof p === 'string' && p.endsWith('/newprofile')) return false
      if (typeof p === 'string' && p.includes('/newprofile/')) return false
      return true
    })
    readFileSync.mockImplementation(() => 'model: auto\n')
  })

  it('rejects agent_ui.tier !== 3 with 400', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({ name: 'newprofile', agent_ui: { tier: 1 } }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/tier must be 3/)
  })

  it('rejects agent_ui.tier = 2 with 400', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({ name: 'newprofile', agent_ui: { tier: 2 } }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts agent_ui.tier = 3', async () => {
    const handler = await getHandler()
    // profile dir must not exist so createProfile does not throw "already exists"
    existsSync.mockReturnValue(false)
    const res = await handler({
      request: makeRequest({ name: 'newprofile', agent_ui: { tier: 3 } }),
    })
    // Should not be a 400 validation error (may be 500 from fs mock, that's fine)
    expect(res.status).not.toBe(400)
  })

  it('rejects lowercase agent_ui.glyph with 400', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({ name: 'newprofile', agent_ui: { glyph: 'ab' } }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/glyph/)
  })

  it('rejects mixed-case agent_ui.glyph with 400', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({ name: 'newprofile', agent_ui: { glyph: 'Ab' } }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts uppercase agent_ui.glyph', async () => {
    const handler = await getHandler()
    existsSync.mockReturnValue(false)
    const res = await handler({
      request: makeRequest({ name: 'newprofile', agent_ui: { glyph: 'AB' } }),
    })
    expect(res.status).not.toBe(400)
  })

  it('rejects persona_id set without system_prompt with 400', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({
        name: 'newprofile',
        agent_ui: { persona_id: 'engineering-code-reviewer' },
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/system_prompt/)
  })

  it('rejects persona_id set with empty string system_prompt with 400', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: makeRequest({
        name: 'newprofile',
        agent_ui: { persona_id: 'engineering-code-reviewer' },
        system_prompt: '   ',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('allows persona_id: null without system_prompt', async () => {
    const handler = await getHandler()
    existsSync.mockReturnValue(false)
    const res = await handler({
      request: makeRequest({
        name: 'newprofile',
        agent_ui: { persona_id: null },
      }),
    })
    // persona_id: null is explicitly allowed — must not be a 400 validation rejection
    expect(res.status).not.toBe(400)
  })
})
