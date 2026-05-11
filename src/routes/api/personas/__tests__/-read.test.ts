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

const CODE_REVIEWER_MD = `---
id: engineering-code-reviewer
category: engineering
glyph: "CR"
name: "Code Reviewer"
description: "Reviews code like a mentor, not a gatekeeper."
tags: [review, quality, mentoring]
---
## Agent Persona: Code Reviewer

You are a Code Reviewer. You review code like a mentor, not a gatekeeper. Every comment teaches something.

### Core Mission
- Evaluate correctness, security, maintainability, performance, and testing
- NOT style preferences — leave that to linters
- Prioritize issues by real impact, not personal preference`

const MULTILINE_MD = `---
id: engineering-multiline
category: engineering
glyph: "ML"
name: "Multiline Expert"
description: "Handles multiline prompts with code blocks."
tags: [multiline, code]
---
Here is a code block:

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`
}
\`\`\`

And more text after the code block.`

// ── dirent helpers ────────────────────────────────────────────────────────────

function makeDir(name: string) {
  return { name, isDirectory: () => true, isFile: () => false } as unknown as import('node:fs').Dirent
}

function makeFile(name: string) {
  return { name, isDirectory: () => false, isFile: () => true } as unknown as import('node:fs').Dirent
}

// ── handler factory ───────────────────────────────────────────────────────────

function makeRequest(id?: string): Request {
  const url = id
    ? `http://localhost/api/personas/read?id=${encodeURIComponent(id)}`
    : 'http://localhost/api/personas/read'
  return new Request(url, { method: 'GET' })
}

async function getHandler() {
  vi.resetModules()
  const mod = await import('../read')
  return (
    mod as unknown as {
      Route: { server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } } }
    }
  ).Route.server.handlers.GET
}

// ── setup ─────────────────────────────────────────────────────────────────────

function setupFsWithContent(content: string) {
  existsSync.mockReturnValue(true)
  readdirSync.mockImplementation((p: string) => {
    if (typeof p === 'string' && p.endsWith('/personas')) return [makeDir('engineering')]
    return [makeFile('code-reviewer.md')]
  })
  readFileSync.mockReturnValue(content)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/personas/read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns full persona for a known id', async () => {
    setupFsWithContent(CODE_REVIEWER_MD)

    const handler = await getHandler()
    const res = await handler({ request: makeRequest('engineering-code-reviewer') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { persona: Record<string, unknown> }
    expect(body.persona).toBeDefined()
    expect(body.persona.id).toBe('engineering-code-reviewer')
  })

  it('returns full system_prompt (not truncated)', async () => {
    setupFsWithContent(CODE_REVIEWER_MD)

    const handler = await getHandler()
    const res = await handler({ request: makeRequest('engineering-code-reviewer') })
    const body = (await res.json()) as { persona: { system_prompt: string } }
    expect(body.persona.system_prompt).toContain('Core Mission')
    expect(body.persona.system_prompt.length).toBeGreaterThan(50)
  })

  it('returns 404 with { error } for unknown id', async () => {
    setupFsWithContent(CODE_REVIEWER_MD)

    const handler = await getHandler()
    const res = await handler({ request: makeRequest('does-not-exist') })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(typeof body.error).toBe('string')
  })

  it('returns 400 when id query param is missing', async () => {
    const handler = await getHandler()
    const res = await handler({ request: makeRequest() })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(typeof body.error).toBe('string')
  })

  it('multi-line system_prompt with code blocks survives round-trip', async () => {
    existsSync.mockReturnValue(true)
    readdirSync.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.endsWith('/personas')) return [makeDir('engineering')]
      return [makeFile('multiline.md')]
    })
    readFileSync.mockReturnValue(MULTILINE_MD)

    const handler = await getHandler()
    const res = await handler({ request: makeRequest('engineering-multiline') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { persona: { system_prompt: string } }
    expect(body.persona.system_prompt).toContain('```typescript')
    expect(body.persona.system_prompt).toContain('function greet')
    expect(body.persona.system_prompt).toContain('And more text after the code block.')
  })

  it('frontmatter fields preserved as typed (tags array, glyph string)', async () => {
    setupFsWithContent(CODE_REVIEWER_MD)

    const handler = await getHandler()
    const res = await handler({ request: makeRequest('engineering-code-reviewer') })
    const body = (await res.json()) as {
      persona: { tags: unknown; glyph: unknown; category: unknown; name: unknown }
    }
    expect(Array.isArray(body.persona.tags)).toBe(true)
    expect(body.persona.tags).toContain('review')
    expect(typeof body.persona.glyph).toBe('string')
    expect(body.persona.glyph).toBe('CR')
    expect(body.persona.category).toBe('engineering')
    expect(body.persona.name).toBe('Code Reviewer')
  })
})
