import { createFileRoute } from '@tanstack/react-router'
import { dashboardFetch } from '../../../server/gateway-capabilities'
import { isAuthenticated } from '../../../server/auth-middleware'

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

  if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    init.body = await request.text()
  }

  // dashboardFetch injects the dashboard bearer token server-side
  const upstream = await dashboardFetch(pathWithSearch, init)

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
