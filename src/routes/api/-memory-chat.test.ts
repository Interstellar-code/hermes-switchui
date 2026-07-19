import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isAuthenticated } = vi.hoisted(() => ({ isAuthenticated: vi.fn() }))
const { openaiChat } = vi.hoisted(() => ({ openaiChat: vi.fn() }))

vi.mock('../../server/auth-middleware', () => ({ isAuthenticated }))
vi.mock('../../server/openai-compat-api', () => ({ openaiChat }))

async function getHandler() {
  vi.resetModules()
  const mod = await import('./memory/chat')
  return (mod.Route as any).options.server.handlers.POST as (ctx: {
    request: Request
  }) => Promise<Response>
}

function post(body: unknown): Request {
  return new Request('http://localhost/api/memory/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function* gen(chunks: Array<{ type: string; text: string }>) {
  for (const c of chunks) yield c
}

describe('/api/memory/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isAuthenticated.mockReturnValue(true)
  })

  it('401 when unauthenticated', async () => {
    isAuthenticated.mockReturnValue(false)
    const handler = await getHandler()
    const res = await handler({ request: post({ message: 'hi' }) })
    expect(res.status).toBe(401)
    expect(openaiChat).not.toHaveBeenCalled()
  })

  it('400 when message is missing', async () => {
    const handler = await getHandler()
    const res = await handler({ request: post({ context: 'x' }) })
    expect(res.status).toBe(400)
    expect(openaiChat).not.toHaveBeenCalled()
  })

  it('streams content as event:chunk/data.text and grounds the system prompt on context', async () => {
    openaiChat.mockResolvedValue(gen([
      { type: 'content', text: 'Sub' },
      { type: 'reasoning', text: 'ignore me' },
      { type: 'content', text: 'sHero' },
    ]))
    const handler = await getHandler()
    const res = await handler({
      request: post({ message: 'about subshero?', context: 'SubsHero is a SaaS' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('event: chunk')
    expect(text).toContain('"text":"Sub"')
    expect(text).toContain('"text":"sHero"')
    expect(text).not.toContain('ignore me') // reasoning chunks dropped
    expect(text).toContain('event: done')

    // system prompt carries the memory context + the strict instruction
    const messages = openaiChat.mock.calls[0][0] as Array<{ role: string; content: string }>
    const system = messages.find((m) => m.role === 'system')
    expect(system?.content).toContain('SubsHero is a SaaS')
    expect(system?.content).toContain("I don't have that in my memory.")
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'about subshero?' })
  })

  it('emits event:error when the model stream throws', async () => {
    openaiChat.mockResolvedValue(
      (function* () {
        yield { type: 'content', text: 'partial' }
        throw new Error('upstream boom')
      })(),
    )
    const handler = await getHandler()
    const res = await handler({ request: post({ message: 'q', context: 'c' }) })
    const text = await res.text()
    expect(text).toContain('event: error')
    expect(text).toContain('upstream boom')
  })
})
