import { describe, expect, it, vi } from 'vitest'
import { Route } from './workflow-events'

const subscribeEvents = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))
vi.mock('../../server/auth-middleware', () => ({ isAuthenticated: () => true }))
vi.mock('../../server/workflow-engine/factory', () => ({
  getEngine: () => ({
    getRun: vi.fn().mockResolvedValue({ id: 'r1' }),
    subscribeEvents: (...args: Array<unknown>) => subscribeEvents(...args),
  }),
}))

describe('GET /api/workflow-events', () => {
  it('passes request.signal to subscribeEvents so client abort tears down upstream', async () => {
    let received: AbortSignal | undefined
    subscribeEvents.mockImplementation(async function* (
      _id: string,
      signal: AbortSignal,
    ) {
      received = signal
      yield { event_type: 'a' }
      await new Promise((r) => signal.addEventListener('abort', r))
    })
    const ac = new AbortController()
    const handlers = (
      Route as unknown as {
        server: { handlers: { GET: (c: { request: Request }) => Response } }
      }
    ).server.handlers
    const res = handlers.GET({
      request: new Request('http://x/api/workflow-events?runId=r1', {
        signal: ac.signal,
      }),
    })
    const reader = res.body!.getReader()
    await reader.read() // 'connected' frame => subscribeEvents is being iterated
    await vi.waitFor(() => expect(received).toBeDefined())
    expect(received!.aborted).toBe(false)
    ac.abort()
    expect(received!.aborted).toBe(true)
  })
})
