import { createFileRoute } from '@tanstack/react-router'
import { BEARER_TOKEN, CLAUDE_API } from '../../../server/gateway-capabilities'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  isProfileScopeError,
  profileErrorStatus,
  readProfile,
  scopedPath,
} from '../../../server/profile-scope'

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
 * Profile policy for this proxy.
 *
 * This is a generic, client-driven passthrough to ANY gateway path, so it is
 * an unbounded send surface — the one place where a caller could reach the
 * gateway without going through a scoped helper. Two rules keep it honest:
 *
 *  1. A client-supplied `/p/<profile>/` splat is REJECTED. It looks scoped but
 *    bypasses the topology check entirely, so on a non-multiplex gateway it is
 *    silently ignored and the write lands in whatever home the gateway runs on
 *    (Hazard A). A prefix nobody validated is worse than no prefix.
 *  2. Scoping is opt-in via the `x-hermes-profile` request header, which is
 *    validated server-side and prefixed through `profilePath`. Without it the
 *    proxy is active-profile-only, exactly as it has always been.
 */
const PROFILE_HEADER = 'x-hermes-profile'

async function proxyRequest(request: Request, splat: string) {
  const incomingUrl = new URL(request.url)
  const rawPath = splat.startsWith('/') ? splat : `/${splat}`
  if (/^\/p\//.test(rawPath)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `Client-supplied /p/ prefixes are not accepted here; send the ${PROFILE_HEADER} header instead.`,
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )
  }

  const profile = readProfile(request.headers.get(PROFILE_HEADER))
  let targetPath: string
  try {
    targetPath = await scopedPath(rawPath, profile)
  } catch (err) {
    if (!isProfileScopeError(err)) throw err
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      {
        status: profileErrorStatus(err),
        headers: { 'content-type': 'application/json' },
      },
    )
  }
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
  const FORWARDED_REQUEST_HEADERS = [
    'accept',
    'content-type',
    'content-length',
    'range',
  ]
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
    try {
      return new URL(CLAUDE_API).host
    } catch {
      return null
    }
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
  // No vanilla-agent fallback for `/api/available-models` here (a previous
  // version synthesized a model list from `GET /v1/models` on a 404). That
  // endpoint is the server's own advertised identity plus any configured
  // `model_routes` aliases — NOT a model catalog (the real catalog is
  // `/api/models`, which reads config.yaml plus the provider's own /models
  // endpoint). Presenting it as if it were a selectable model list would be
  // a bogus entry in the settings UI. On a 404 (or any other upstream
  // status), the response below passes straight through, and
  // `settings-dialog.tsx`'s `fetchModelsForProvider` already degrades
  // gracefully — an empty/absent `models` array (or a JSON-parse failure)
  // falls through to auto-discovered local-provider models, then to the
  // hardcoded `PROVIDER_CARDS` list.
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
