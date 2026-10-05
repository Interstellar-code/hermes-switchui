import { beforeEach, describe, expect, it, vi } from 'vitest'

const dashboardFetch = vi.fn()
vi.mock('./gateway-capabilities', () => ({ dashboardFetch }))
vi.mock('./auth-middleware', () => ({ isAuthenticated: () => true }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: unknown) => ({ options: cfg }),
}))

type H = Record<string, (a: unknown) => Promise<Response>>
const handlers = async (): Promise<H> =>
  (
    (await import('../routes/api/workflow-schedules.$id')).Route as unknown as {
      options: { server: { handlers: H } }
    }
  ).options.server.handlers

const req = (method: string, body?: unknown, ct = 'application/json') =>
  new Request('http://x/api/workflow-schedules/s1', {
    method,
    headers: { 'content-type': ct },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

describe('workflow-schedules routes', () => {
  beforeEach(() => dashboardFetch.mockReset())

  it('PATCH forwards enabled', async () => {
    dashboardFetch.mockResolvedValue(Response.json({ schedule: { id: 's1' } }))
    const res = await (
      await handlers()
    ).PATCH({ request: req('PATCH', { enabled: false }), params: { id: 's1' } })
    expect(res.status).toBe(200)
    expect(dashboardFetch.mock.calls[0][0]).toMatch(/schedules\/s1$/)
  })
  it('PATCH rejects non-JSON and bad body', async () => {
    const h = await handlers()
    expect(
      (
        await h.PATCH({
          request: req('PATCH', {}, 'text/plain'),
          params: { id: 's1' },
        })
      ).status,
    ).toBe(415)
    expect(
      (
        await h.PATCH({
          request: req('PATCH', { enabled: 'x' }),
          params: { id: 's1' },
        })
      ).status,
    ).toBe(400)
  })
  it('DELETE maps upstream errors to generic bodies', async () => {
    dashboardFetch.mockResolvedValue(
      new Response('secret trace', { status: 404 }),
    )
    const res = await (
      await handlers()
    ).DELETE({ request: req('DELETE'), params: { id: 's1' } })
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).not.toMatch(/secret/)
    dashboardFetch.mockResolvedValue(new Response('boom', { status: 500 }))
    expect(
      (
        await (
          await handlers()
        ).DELETE({ request: req('DELETE'), params: { id: 's1' } })
      ).status,
    ).toBe(502)
  })
})
