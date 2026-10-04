import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './conductor/runs.$id.sessions'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts as object,
}))
vi.mock('../../server/auth-middleware', () => ({ isAuthenticated: () => true }))

const dash = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../server/gateway-capabilities', () => ({
  dashboardFetch: dash.fetch,
}))

type Handler = (ctx: {
  request: Request
  params: Record<string, string>
}) => Promise<Response>
const GET = (Route as unknown as { server: { handlers: { GET: Handler } } })
  .server.handlers.GET
const call = () =>
  GET({ request: new Request('http://x/'), params: { id: 'r1' } })

describe('GET /api/conductor/runs/:id/sessions', () => {
  beforeEach(() => dash.fetch.mockReset())

  it('degrades to available:false when the backend 404s', async () => {
    dash.fetch.mockResolvedValue(new Response('nope', { status: 404 }))
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ available: false, data: null })
  })

  it('passes the payload through when present', async () => {
    const data = { owner: null, nodes: [], totals: { sessions: 0 } }
    dash.fetch.mockResolvedValue(Response.json(data))
    expect(await (await call()).json()).toEqual({ available: true, data })
  })

  it('maps non-404 upstream errors to 502 available:false', async () => {
    dash.fetch.mockResolvedValue(new Response('boom', { status: 500 }))
    const res = await call()
    expect(res.status).toBe(502)
    expect((await res.json()).available).toBe(false)
  })
})
