import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The two approval proxies. Drives the REAL handlers with only the gateway
 * stubbed, because the whole point of these routes is how they map gateway
 * statuses — a test that mocked the mapping would prove nothing.
 *
 * Contract v1 §2: 409 and 404 are benign (already handled, or the run was
 * swept); 400/401/500 are real failures. §3: a gateway with no catch-up
 * endpoint 404s, and that is not an error worth surfacing.
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

async function resolveApproval(
  body: Record<string, unknown>,
  runId = 'run_1111',
  headers: Record<string, string> = { 'Content-Type': 'application/json' },
) {
  const route = (await import('./runs.$runId.approval')).Route as unknown as {
    server: { handlers: { POST: Handler } }
  }
  return route.server.handlers.POST({
    request: new Request('http://localhost/api/runs/run_1111/approval', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    params: { runId },
  })
}

async function listPending(query = '') {
  const route = (await import('./approvals.pending')).Route as unknown as {
    server: { handlers: { GET: Handler } }
  }
  return route.server.handlers.GET({
    request: new Request(`http://localhost/api/approvals/pending${query}`),
    params: {},
  })
}

beforeEach(() => {
  gateway.fetch.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/runs/:runId/approval', () => {
  it('forwards the choice to the run-keyed gateway endpoint', async () => {
    gateway.fetch.mockResolvedValue(
      gatewayJson(200, {
        object: 'hermes.run.approval_response',
        run_id: 'run_1111',
        approval_id: 'approval_1',
        choice: 'once',
        approved: true,
        resolved: 1,
      }),
    )

    const res = await resolveApproval({ choice: 'once' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, resolved: 1 })

    const [path, init] = gateway.fetch.mock.calls[0]
    expect(path).toBe('/v1/runs/run_1111/approval')
    expect(JSON.parse(init.body)).toEqual({ choice: 'once' })
  })

  it('applies the gateway aliases so approve/allow are not 400s', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(200, {}))
    await resolveApproval({ choice: 'Approve' })
    expect(JSON.parse(gateway.fetch.mock.calls[0][1].body)).toEqual({
      choice: 'once',
    })
  })

  it('scopes the path when a profile is supplied', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(200, {}))
    await resolveApproval({ choice: 'deny', profile: 'neo' })
    expect(gateway.fetch.mock.calls[0][0]).toBe('/p/neo/v1/runs/run_1111/approval')
  })

  it('marks 409 benign — already handled, or timed out', async () => {
    gateway.fetch.mockResolvedValue(
      gatewayJson(409, {
        error: {
          code: 'approval_not_pending',
          message: 'Run has no pending approval: run_1111',
        },
      }),
    )
    const res = await resolveApproval({ choice: 'once' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      ok: false,
      benign: true,
      reason: 'not_pending',
    })
  })

  it('marks 404 benign — the run was swept', async () => {
    gateway.fetch.mockResolvedValue(
      gatewayJson(404, { error: { message: 'Run not found: run_1111' } }),
    )
    const res = await resolveApproval({ choice: 'once' })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ benign: true, reason: 'run_not_found' })
  })

  it('keeps 400/401/500 loud — no benign flag', async () => {
    for (const status of [400, 401, 500]) {
      gateway.fetch.mockResolvedValue(
        gatewayJson(status, { error: { message: 'nope' } }),
      )
      const res = await resolveApproval({ choice: 'once' })
      expect(res.status).toBe(status)
      const json = (await res.json()) as Record<string, unknown>
      expect(json.benign).toBeUndefined()
      expect(json.error).toBe('nope')
    }
  })

  it('rejects a choice outside the enum before touching the gateway', async () => {
    const res = await resolveApproval({ choice: 'maybe' })
    expect(res.status).toBe(400)
    expect(gateway.fetch).not.toHaveBeenCalled()
  })

  it('rejects a request without the JSON content type (CSRF guard)', async () => {
    const res = await resolveApproval({ choice: 'once' }, 'run_1111', {})
    expect(res.status).toBe(415)
    expect(gateway.fetch).not.toHaveBeenCalled()
  })

  it('reports a transport failure as a real 500', async () => {
    gateway.fetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await resolveApproval({ choice: 'once' })
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, error: 'ECONNREFUSED' })
  })
})

describe('GET /api/approvals/pending', () => {
  it('returns the gateway list', async () => {
    gateway.fetch.mockResolvedValue(
      gatewayJson(200, {
        approvals: [{ run_id: 'run_1', session_id: 's1', command: 'rm -rf /' }],
      }),
    )
    const res = await listPending()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      approvals: [{ run_id: 'run_1' }],
    })
  })

  it('degrades quietly when the gateway build has no catch-up endpoint', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(404, {}))
    const res = await listPending()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      approvals: [],
      unsupported: true,
    })
  })

  it('never returns a non-array as approvals', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(200, { approvals: 'nope' }))
    expect(await (await listPending()).json()).toEqual({ ok: true, approvals: [] })
  })

  it('scopes the path when a profile is on the query string', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(200, { approvals: [] }))
    await listPending('?profile=neo')
    expect(gateway.fetch.mock.calls[0][0]).toBe('/p/neo/v1/approvals/pending')
  })

  it('surfaces a real gateway failure with an empty list', async () => {
    gateway.fetch.mockResolvedValue(gatewayJson(500, { error: 'boom' }))
    const res = await listPending()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, approvals: [], error: 'boom' })
  })
})
