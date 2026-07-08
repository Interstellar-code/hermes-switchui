import { createFileRoute } from '@tanstack/react-router'
import { BEARER_TOKEN, CLAUDE_API } from '../../../server/gateway-capabilities'
import { isAuthenticated } from '../../../server/auth-middleware'

/**
 * Operator-supplied allowlist of permitted proxy target hostnames.
 * Loopback (127.x, ::1, localhost) is always allowed.
 * When unset, the effective allowlist is just the gateway host from CLAUDE_API.
 */
const EXTRA_PROXY_ALLOWED_HOSTS: Set<string> = new Set(
  (process.env.ALLOWED_GATEWAY_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
)

function isAllowedProxyHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '::1') return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  if (EXTRA_PROXY_ALLOWED_HOSTS.has(h)) return true
  // Always allow the configured gateway host
  try {
    const gatewayHost = new URL(CLAUDE_API).hostname.toLowerCase()
    if (h === gatewayHost) return true
  } catch {
    // ignore malformed CLAUDE_API
  }
  return false
}

/**
 * Vanilla hermes-agent (any version through 2026-05) does not expose
 * `/api/available-models` — that's a legacy fork-only endpoint. When the
 * proxy gets a 404, synthesize a compatible response from `/v1/models`
 * filtered by provider so the chat composer / settings dialog don't
 * silently break for users on vanilla agent.
 */
async function fallbackAvailableModels(
  provider: string,
  authHeaders: Record<string, string>,
): Promise<Response> {
  try {
    const res = await fetch(`${CLAUDE_API}/v1/models`, { headers: authHeaders })
    if (!res.ok) {
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const data = (await res.json()) as { data?: Array<Record<string, unknown>> }
    const list = Array.isArray(data.data) ? data.data : []
    const wanted = provider.toLowerCase()
    const models = list
      .map((m) => {
        const id = typeof m.id === 'string' ? m.id : ''
        if (!id) return null
        const owned = typeof m.owned_by === 'string' ? m.owned_by.toLowerCase() : ''
        const idProvider = id.includes('/') ? id.split('/')[0].toLowerCase() : owned
        if (wanted && idProvider !== wanted) return null
        return { id }
      })
      .filter((m): m is { id: string } => Boolean(m))
    return new Response(JSON.stringify({ models }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

async function proxyRequest(request: Request, splat: string) {
  const incomingUrl = new URL(request.url)
  const targetPath = splat.startsWith('/') ? splat : `/${splat}`
  const targetUrl = new URL(`${CLAUDE_API}${targetPath}`)
  targetUrl.search = incomingUrl.search

  // Enforce allowlist: reject if the resolved target host is not permitted.
  if (!isAllowedProxyHost(targetUrl.hostname)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Proxy target host not allowed' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )
  }

  // Only forward a safe subset of request headers — never pass cookies or
  // workspace-internal auth headers to the upstream gateway.
  const FORWARDED_REQUEST_HEADERS = ['accept', 'content-type', 'content-length', 'range']
  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const val = request.headers.get(name)
    if (val) headers.set(name, val)
  }

  // Scope the bearer token: only attach when the resolved target host matches
  // the configured gateway host (prevents token leakage on SSRF/misconfiguration).
  const bearer =
    process.env.HERMES_API_TOKEN || process.env.CLAUDE_API_TOKEN || BEARER_TOKEN
  const configuredHost = (() => {
    try { return new URL(CLAUDE_API).host } catch { return null }
  })()
  if (bearer && configuredHost && targetUrl.host === configuredHost) {
    headers.set('Authorization', `Bearer ${bearer}`)
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  }

  if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    init.body = await request.text()
  }

  const upstream = await fetch(targetUrl, init)
  // Vanilla agent fallback for /api/available-models — synthesize from /v1/models.
  if (
    upstream.status === 404 &&
    request.method.toUpperCase() === 'GET' &&
    /\/api\/available-models\b/.test(targetPath)
  ) {
    const provider = incomingUrl.searchParams.get('provider') || ''
    const authHeaders: Record<string, string> = bearer
      ? { Authorization: `Bearer ${bearer}` }
      : {}
    return fallbackAvailableModels(provider, authHeaders)
  }

  const body = await upstream.text()
  const responseHeaders = new Headers()
  const contentType = upstream.headers.get('content-type')
  if (contentType) responseHeaders.set('content-type', contentType)
  return new Response(body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}

export const Route = createFileRoute('/api/claude-proxy/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }
        return proxyRequest(request, params._splat || '')
      },
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }
        return proxyRequest(request, params._splat || '')
      },
      PATCH: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }
        return proxyRequest(request, params._splat || '')
      },
      DELETE: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }
        return proxyRequest(request, params._splat || '')
      },
    },
  },
})
