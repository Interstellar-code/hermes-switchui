import { createFileRoute } from '@tanstack/react-router'
import { dashboardFetch } from '../../../server/gateway-capabilities'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'

/**
 * `getConfigCached()` in server/hermes-api.ts serves the config to every
 * session-status poll from a 30s TTL cache. A settings save goes through this
 * proxy, not through that module, so without this the UI can keep reading a
 * stale config for up to 30 seconds after a successful write.
 */
function touchesConfig(targetPath: string): boolean {
  return targetPath === '/api/config' || targetPath.startsWith('/api/config/')
}

/**
 * Imported lazily: this proxy sits in front of every dashboard request, and
 * `hermes-api` is a large module that logs at import time. Pulling it in
 * statically would make every consumer of this route load it too.
 */
async function invalidateServerConfigCache(): Promise<void> {
  const { invalidateConfigCache } = await import('../../../server/hermes-api')
  invalidateConfigCache()
}

async function proxyRequest(request: Request, splat: string): Promise<Response> {
  const incomingUrl = new URL(request.url)
  const targetPath = splat.startsWith('/') ? splat : `/${splat}`
  const pathWithSearch = incomingUrl.search
    ? `${targetPath}${incomingUrl.search}`
    : targetPath

  const init: RequestInit = {
    method: request.method,
    redirect: 'manual',
  }

  const contentType = request.headers.get('content-type')
  if (contentType) {
    init.headers = { 'content-type': contentType }
  }

  const method = request.method.toUpperCase()
  const isWrite = !['GET', 'HEAD'].includes(method)
  if (isWrite) {
    init.body = await request.text()
  }

  // dashboardFetch injects the dashboard bearer token server-side
  const upstream = await dashboardFetch(pathWithSearch, init)

  if (isWrite && upstream.ok && touchesConfig(targetPath)) {
    await invalidateServerConfigCache()
  }

  const body = await upstream.arrayBuffer()
  const responseHeaders = new Headers()
  const upContentType = upstream.headers.get('content-type')
  if (upContentType) responseHeaders.set('content-type', upContentType)

  return new Response(body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}

function makeHandler(method: string) {
  return async ({ request, params }: { request: Request; params: { _splat?: string } }) => {
    const csrfCheck = requireJsonContentType(request)
    if (csrfCheck) return csrfCheck
    if (!isAuthenticated(request)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized' }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      )
    }
    return proxyRequest(request, params._splat || '')
  }
}

export const Route = createFileRoute('/api/dashboard-proxy/$')({
  server: {
    handlers: {
      GET: makeHandler('GET'),
      POST: makeHandler('POST'),
      PATCH: makeHandler('PATCH'),
      PUT: makeHandler('PUT'),
      DELETE: makeHandler('DELETE'),
    },
  },
})
