import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Task #26 item 1 — `GET /v1/models` on the gateway is NOT a model catalog.
 * It returns the server's own advertised identity (e.g. "hermes-agent", or
 * the active profile name) plus any configured `model_routes` aliases. This
 * proxy used to synthesize a fake `/api/available-models` response from that
 * endpoint whenever a vanilla gateway 404'd on the real thing, presenting the
 * server's own identity as if it were a selectable model — a bogus entry in
 * the settings dialog.
 *
 * `settings-dialog.tsx`'s `fetchModelsForProvider` already degrades
 * gracefully on an empty/absent `models` array or a JSON-parse failure (falls
 * through to auto-discovered local-provider models, then to the hardcoded
 * `PROVIDER_CARDS` list), so the fix is to drop the synthesis entirely and
 * let the upstream 404 pass straight through.
 */

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts as object,
}))

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

vi.mock('../../../server/gateway-capabilities', () => ({
  BEARER_TOKEN: '',
  CLAUDE_API: 'http://127.0.0.1:8642',
}))

describe('GET /api/claude-proxy/api/available-models on a vanilla-agent 404', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    vi.resetModules()
  })

  it('passes the upstream 404 straight through instead of querying /v1/models', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const { Route } = await import('./$')
    const request = new Request(
      'http://localhost/api/claude-proxy/api/available-models?provider=openai',
      { method: 'GET' },
    )
    const response = await Route.server.handlers.GET({
      request,
      params: { _splat: 'api/available-models' },
    })

    expect(response.status).toBe(404)
    // Exactly one upstream call — no second /v1/models fetch synthesizing a
    // model list from the gateway's identity endpoint.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const calledUrl = String(fetchSpy.mock.calls[0]?.[0])
    expect(calledUrl).toContain('/api/available-models')
    expect(calledUrl).not.toContain('/v1/models')
  })

  it('never returns a synthesized "models" array derived from /v1/models', async () => {
    fetchSpy.mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    )

    const { Route } = await import('./$')
    const request = new Request(
      'http://localhost/api/claude-proxy/api/available-models?provider=openai',
      { method: 'GET' },
    )
    const response = await Route.server.handlers.GET({
      request,
      params: { _splat: 'api/available-models' },
    })
    const body = await response.text()

    expect(body).toBe('Not Found')
  })
})
