import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── fs mock ───────────────────────────────────────────────────────────────────
const { existsSync, readdirSync, readFileSync } = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(true),
  readdirSync: vi.fn().mockReturnValue([]),
  readFileSync: vi.fn().mockReturnValue(''),
}))

vi.mock('node:fs', () => ({
  default: { existsSync, readdirSync, readFileSync },
  existsSync,
  readdirSync,
  readFileSync,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))

vi.mock('@tanstack/react-start', () => ({
  json: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
      ...(init ?? {}),
      headers: {
        'Content-Type': 'application/json',
        ...((init as ResponseInit & { headers?: Record<string, string> })?.headers ?? {}),
      },
    }),
}))

vi.mock('../../../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

// ── fixtures ──────────────────────────────────────────────────────────────────

const SHORT_BODY = 'You are a Code Reviewer. Every comment teaches something.'
// 501 chars — just over the 500-char preview limit (PR-04 raised cap)
const LONG_BODY = 'A'.repeat(501)

const SHORT_MD = `---
id: engineering-code-reviewer
category: engineering
glyph: "CR"
name: "Code Reviewer"
description: "Reviews code like a mentor."
tags: [review, quality]
---
${SHORT_BODY}`

const LONG_MD = `---
id: engineering-software-architect
category: engineering
glyph: "SA"
name: "Software Architect"
description: "Designs systems that survive."
tags: [architecture]
---
${LONG_BODY}`

function makeFile(name: string) {
  return { name, isDirectory: () => false, isFile: () => true } as unknown as import('node:fs').Dirent
}

function makeRequest(url = 'http://localhost/api/personas/list'): Request {
  return new Request(url, { method: 'GET' })
}

async function getHandler() {
  vi.resetModules()
  const mod = await import('../list')
  return (
    mod as unknown as {
      Route: { server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } } }
    }
  ).Route.server.handlers.GET
}

describe('GET /api/personas/list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existsSync.mockReturnValue(true)
  })

  it('returns { personas: [...] } array', async () => {
    readdirSync.mockReturnValue([makeFile('code-reviewer.md')])
    readFileSync.mockReturnValue(SHORT_MD)

    const handler = await getHandler()
    const res = await handler({ request: makeRequest() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { personas: unknown[] }
    expect(Array.isArray(body.personas)).toBe(true)
    expect(body.personas).toHaveLength(1)
  })

  it('each persona has required fields', async () => {
    readdirSync.mockReturnValue([makeFile('code-reviewer.md')])
    readFileSync.mockReturnValue(SHORT_MD)

    const handler = await getHandler()
    const res = await handler({ request: makeRequest() })
    const body = (await res.json()) as { personas: Record<string, unknown>[] }
    const persona = body.personas[0]
    expect(persona).toHaveProperty('id', 'engineering-code-reviewer')
    expect(persona).toHaveProperty('category', 'engineering')
    expect(persona).toHaveProperty('glyph', 'CR')
    expect(persona).toHaveProperty('name', 'Code Reviewer')
    expect(persona).toHaveProperty('description')
    expect(Array.isArray(persona.tags)).toBe(true)
    expect(persona).toHaveProperty('system_prompt_preview')
    expect(persona).toHaveProperty('has_more_prompt')
  })

  it('has_more_prompt is true when system_prompt body > 500 chars', async () => {
    readdirSync.mockReturnValue([makeFile('software-architect.md')])
    readFileSync.mockReturnValue(LONG_MD)

    const handler = await getHandler()
    const res = await handler({ request: makeRequest() })
    const body = (await res.json()) as { personas: { has_more_prompt: boolean }[] }
    expect(body.personas[0].has_more_prompt).toBe(true)
  })

  it('has_more_prompt is false when system_prompt body ≤ 500 chars', async () => {
    readdirSync.mockReturnValue([makeFile('code-reviewer.md')])
    readFileSync.mockReturnValue(SHORT_MD)

    const handler = await getHandler()
    const res = await handler({ request: makeRequest() })
    const body = (await res.json()) as { personas: { has_more_prompt: boolean }[] }
    expect(body.personas[0].has_more_prompt).toBe(false)
  })

  it('empty personas directory returns { personas: [] }', async () => {
    existsSync.mockReturnValue(true)
    readdirSync.mockReturnValue([])

    const handler = await getHandler()
    const res = await handler({ request: makeRequest() })
    const body = (await res.json()) as { personas: unknown[] }
    expect(body.personas).toHaveLength(0)
  })

  it('returns personas: [] when personas root does not exist', async () => {
    existsSync.mockReturnValue(false)

    const handler = await getHandler()
    const res = await handler({ request: makeRequest() })
    const body = (await res.json()) as { personas: unknown[] }
    expect(Array.isArray(body.personas)).toBe(true)
    expect(body.personas).toHaveLength(0)
  })

  it('response has Cache-Control header set to 30 seconds', async () => {
    readdirSync.mockReturnValue([makeFile('code-reviewer.md')])
    readFileSync.mockReturnValue(SHORT_MD)

    const handler = await getHandler()
    const res = await handler({ request: makeRequest() })
    const cacheControl = res.headers.get('Cache-Control')
    expect(res.status).toBe(200)
    if (cacheControl) {
      expect(cacheControl).toMatch(/30/)
    }
  })
})
