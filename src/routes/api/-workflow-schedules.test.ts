import { beforeEach, describe, expect, it, vi } from 'vitest'

const dashboardFetch = vi.fn()
const isAuthenticated = vi.fn()
vi.mock('../../server/gateway-capabilities', () => ({ dashboardFetch }))
vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: (...a: Array<unknown>) => isAuthenticated(...a),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: unknown) => ({ options: cfg }),
}))

type H = Record<string, (a: unknown) => Promise<Response>>
const handlersOf = (mod: { Route: unknown }): H =>
  (mod.Route as { options: { server: { handlers: H } } }).options.server
    .handlers
const byId = async () => handlersOf(await import('./workflow-schedules.$id'))
const list = async () => handlersOf(await import('./workflow-schedules'))

const req = (method: string, body?: unknown, ct = 'application/json') =>
  new Request('http://x/api/workflow-schedules/s1', {
    method,
    headers: { 'content-type': ct },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

describe('workflow-schedules routes', () => {
  beforeEach(() => {
    dashboardFetch.mockReset()
    isAuthenticated.mockReset().mockReturnValue(true)
  })

  it('401 without auth on every handler', async () => {
    isAuthenticated.mockReturnValue(false)
    const h = await byId()
    const get = (await list()).GET
    expect(
      (
        await h.PATCH({
          request: req('PATCH', { enabled: true }),
          params: { id: 's1' },
        })
      ).status,
    ).toBe(401)
    expect(
      (await h.DELETE({ request: req('DELETE'), params: { id: 's1' } })).status,
    ).toBe(401)
    expect(
      (await get({ request: new Request('http://x/api/workflow-schedules') }))
        .status,
    ).toBe(401)
    expect(dashboardFetch).not.toHaveBeenCalled()
  })

  it('GET lists schedules, forwarding workflow_id', async () => {
    dashboardFetch.mockResolvedValue(
      Response.json({ schedules: [{ id: 's1' }] }),
    )
    const res = await (
      await list()
    ).GET({
      request: new Request('http://x/api/workflow-schedules?workflow_id=a.b'),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ schedules: [{ id: 's1' }] })
    expect(dashboardFetch.mock.calls[0][0]).toBe(
      '/api/plugins/workflow-engine/schedules?workflow_id=a.b',
    )
  })

  it('GET rejects an invalid workflow_id', async () => {
    const res = await (
      await list()
    ).GET({
      request: new Request('http://x/api/workflow-schedules?workflow_id=..'),
    })
    expect(res.status).toBe(400)
    expect(dashboardFetch).not.toHaveBeenCalled()
  })

  it('GET maps upstream failure to a generic error', async () => {
    dashboardFetch.mockResolvedValue(new Response('trace', { status: 500 }))
    const get = (await list()).GET
    const res = await get({
      request: new Request('http://x/api/workflow-schedules'),
    })
    expect(res.status).toBe(502)
    expect(JSON.stringify(await res.json())).not.toMatch(/trace/)
    dashboardFetch.mockResolvedValue(new Response('', { status: 404 }))
    expect(
      (await get({ request: new Request('http://x/api/workflow-schedules') }))
        .status,
    ).toBe(404)
    dashboardFetch.mockRejectedValue(new Error('down'))
    expect(
      (await get({ request: new Request('http://x/api/workflow-schedules') }))
        .status,
    ).toBe(502)
  })

  it('PATCH forwards enabled', async () => {
    dashboardFetch.mockResolvedValue(Response.json({ schedule: { id: 's1' } }))
    const res = await (
      await byId()
    ).PATCH({ request: req('PATCH', { enabled: false }), params: { id: 's1' } })
    expect(res.status).toBe(200)
    expect(dashboardFetch.mock.calls[0][0]).toMatch(/schedules\/s1$/)
  })

  it('PATCH rejects non-JSON, bad body and path-like ids', async () => {
    const h = await byId()
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
    for (const id of ['.', '..', '...', 'a/b'])
      expect(
        (
          await h.PATCH({
            request: req('PATCH', { enabled: true }),
            params: { id },
          })
        ).status,
      ).toBe(400)
    expect(dashboardFetch).not.toHaveBeenCalled()
  })

  it('DELETE maps upstream errors to generic bodies', async () => {
    dashboardFetch.mockResolvedValue(
      new Response('secret trace', { status: 404 }),
    )
    const res = await (
      await byId()
    ).DELETE({ request: req('DELETE'), params: { id: 's1' } })
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).not.toMatch(/secret/)
    dashboardFetch.mockResolvedValue(new Response('boom', { status: 500 }))
    expect(
      (
        await (
          await byId()
        ).DELETE({ request: req('DELETE'), params: { id: 's1' } })
      ).status,
    ).toBe(502)
  })
})
