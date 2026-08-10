import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The two run-stop proxies. Drives the REAL handlers with only the gateway and
 * the run store stubbed, because the whole point of these routes is how they
 * map gateway statuses — a test that mocked the mapping would prove nothing.
 *
 * The load-bearing case is the 404: the gateway answers `run_not_found` both
 * for a run that already finished and for one it never knew, and the caller
 * must be able to tell those apart (and from "still running, just not
 * stoppable") without guessing from the status code.
 */

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts as object,
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

const gateway = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('../../server/gateway-capabilities', () => ({
  gatewayFetch: gateway.fetch,
}))

const runStore = vi.hoisted(() => ({ getActiveRunForSession: vi.fn() }))

vi.mock('../../server/run-store', () => ({
  getActiveRunForSession: runStore.getActiveRunForSession,
}))

vi.mock('../../server/profile-scope', () => ({
  assertProfileServed: vi.fn(async () => undefined),
  isProfileScopeError: () => false,
  profileErrorStatus: () => 502,
  readProfile: (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  scopedPath: vi.fn(async (path: string, profile: string | null) =>
    profile ? `/p/${profile}${path}` : path,
  ),
}))

function gatewayJson(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

type Handler = (ctx: {
  request: Request
  params: Record<string, string>
}) => Promise<Response>

async function stopRun(
  body: Record<string, unknown> = { sessionKey: 'sess-1' },
  runId = 'active',
  headers: Record<string, string> = { 'Content-Type': 'application/json' },
) {
  const route = (await import('./runs.$runId.stop')).Route as unknown as {
    server: { handlers: { POST: Handler } }
  }
  return route.server.handlers.POST({
    request: new Request(`http://localhost/api/runs/${runId}/stop`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    params: { runId },
  })
}

async function readRunStatus(runId = 'run_1111', query = '') {
  const route = (await import('./runs.$runId.status')).Route as unknown as {
    server: { handlers: { GET: Handler } }
  }
  return route.server.handlers.GET({
    request: new Request(`http://localhost/api/runs/${runId}/status${query}`),
    params: { runId },
  })
}

beforeEach(() => {
  gateway.fetch.mockReset()
  runStore.getActiveRunForSession.mockReset()
  runStore.getActiveRunForSession.mockResolvedValue({ runId: 'run_1111' })
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/runs/:runId/stop', () => {
  it('resolves the run id from the session and calls the gateway with it', async () => {
    gateway.fetch.mockResolvedValue(
      gatewayJson(200, { run_id: 'run_1111', status: 'stopping' }),
    )

    const res = await stopRun({ sessionKey: 'sess-1' })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      reason: 'stopping',
      runId: 'run_1111',
      status: 'stopping',
    })

    expect(runStore.getActiveRunForSession).toHaveBeenCalledWith('sess-1')
    const [path, init] = gateway.fetch.mock.calls[0]
    expect(path).toBe('/v1/runs/run_1111/stop')
    expect(init.method).toBe('POST')
  })

  it('uses an explicit run id from the path without touching the run store', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(200, { status: 'stopping' }))

    const res = await stopRun({}, 'run_explicit')

    expect(res.status).toBe(200)
    expect(runStore.getActiveRunForSession).not.toHaveBeenCalled()
    expect(gateway.fetch.mock.calls[0][0]).toBe('/v1/runs/run_explicit/stop')
  })

  it('scopes both the store key and the gateway path when a profile is supplied', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(200, {}))

    await stopRun({ sessionKey: 'sess-1', profile: 'neo' })

    expect(runStore.getActiveRunForSession).toHaveBeenCalledWith('neo::sess-1')
    expect(gateway.fetch.mock.calls[0][0]).toBe('/p/neo/v1/runs/run_1111/stop')
  })

  it('never claims the run stopped — a 200 only ever reports "stopping"', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(200, {}))
    const body = (await (await stopRun()).json()) as { status: string }
    expect(body.status).toBe('stopping')
  })

  it('reads a 404 with a terminal status as "already finished" (benign)', async () => {
    gateway.fetch
      .mockResolvedValueOnce(
        gatewayJson(404, { error: { code: 'run_not_found' } }),
      )
      .mockResolvedValueOnce(
        gatewayJson(200, { run_id: 'run_1111', status: 'completed' }),
      )

    const res = await stopRun()

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({
      ok: false,
      benign: true,
      reason: 'already_finished',
      status: 'completed',
    })
    expect(gateway.fetch.mock.calls[1][0]).toBe('/v1/runs/run_1111')
  })

  it('reads a 404 with a LIVE status as not stoppable, and NOT benign', async () => {
    gateway.fetch
      .mockResolvedValueOnce(gatewayJson(404, {}))
      .mockResolvedValueOnce(gatewayJson(200, { status: 'running' }))

    const res = await stopRun()

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({
      ok: false,
      benign: false,
      reason: 'not_stoppable',
      status: 'running',
    })
  })

  it('reads a 404 on both calls as unknown — not benign, not "already finished"', async () => {
    gateway.fetch
      .mockResolvedValueOnce(
        gatewayJson(404, {
          error: { message: 'Run not found: run_1111', code: 'run_not_found' },
        }),
      )
      .mockResolvedValueOnce(gatewayJson(404, {}))

    const res = await stopRun()
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(404)
    expect(body.reason).toBe('run_not_found')
    expect(body.benign).toBe(false)
    expect(body.error).toBe('Run not found: run_1111')
  })

  it('treats a failed status probe as unknown rather than as confirmation', async () => {
    gateway.fetch
      .mockResolvedValueOnce(gatewayJson(404, {}))
      .mockRejectedValueOnce(new Error('gateway down'))

    const body = (await (await stopRun()).json()) as Record<string, unknown>
    expect(body.reason).toBe('run_not_found')
    expect(body.benign).toBe(false)
  })

  it('reports no_active_run without calling the gateway, and does not call it benign', async () => {
    runStore.getActiveRunForSession.mockResolvedValue(null)

    const res = await stopRun({ sessionKey: 'sess-1' })

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({
      ok: false,
      benign: false,
      reason: 'no_active_run',
    })
    expect(gateway.fetch).not.toHaveBeenCalled()
  })

  it('400s when the active token is used with no sessionKey', async () => {
    const res = await stopRun({})
    expect(res.status).toBe(400)
    expect(gateway.fetch).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON content type (CSRF check) before anything else', async () => {
    const res = await stopRun({ sessionKey: 'sess-1' }, 'active', {
      'Content-Type': 'text/plain',
    })
    expect(res.status).toBe(415)
    expect(gateway.fetch).not.toHaveBeenCalled()
  })

  it('tolerates an unparseable body when the run id is explicit — the gateway reads none', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(200, {}))
    const route = (await import('./runs.$runId.stop')).Route as unknown as {
      server: { handlers: { POST: Handler } }
    }
    const res = await route.server.handlers.POST({
      request: new Request('http://localhost/api/runs/run_x/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }),
      params: { runId: 'run_x' },
    })
    expect(res.status).toBe(200)
  })

  it('passes a non-404 gateway failure through loudly', async () => {
    gateway.fetch.mockResolvedValue(
      gatewayJson(401, { error: { message: 'Invalid API key' } }),
    )

    const res = await stopRun()
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({
      ok: false,
      reason: 'error',
      error: 'Invalid API key',
    })
  })

  it('500s on a transport failure rather than pretending the stop landed', async () => {
    gateway.fetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await stopRun()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, reason: 'error' })
  })
})

describe('GET /api/runs/:runId/status', () => {
  it('returns the gateway status verbatim', async () => {
    gateway.fetch.mockResolvedValue(
      gatewayJson(200, { run_id: 'run_1111', status: 'stopping' }),
    )

    const res = await readRunStatus()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      runId: 'run_1111',
      status: 'stopping',
    })
    expect(gateway.fetch.mock.calls[0][0]).toBe('/v1/runs/run_1111')
  })

  it('reports the cancelled terminal the UI waits for', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(200, { status: 'cancelled' }))
    const body = (await (await readRunStatus()).json()) as { status: string }
    expect(body.status).toBe('cancelled')
  })

  it('scopes the path when a profile is supplied', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(200, { status: 'running' }))
    await readRunStatus('run_1111', '?profile=neo')
    expect(gateway.fetch.mock.calls[0][0]).toBe('/p/neo/v1/runs/run_1111')
  })

  it('flags an aged-out record as benign', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(404, {}))
    const res = await readRunStatus()
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({
      ok: false,
      benign: true,
      reason: 'run_not_found',
    })
  })
})
