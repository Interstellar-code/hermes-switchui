import { describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { readHermesDoc } from '../../server/hermes-docs'
import { Route } from './hermes-docs'
import type * as HermesDocsModule from '../../server/hermes-docs'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(() => true),
}))

vi.mock('../../server/hermes-docs', async () => {
  const actual = await vi.importActual<typeof HermesDocsModule>('../../server/hermes-docs')
  return {
    ...actual,
    readHermesDoc: vi.fn(),
  }
})

type RouteWithHandlers = typeof Route & {
  options: {
    server: {
      handlers: {
        GET: (ctx: { request: Request }) => Response | Promise<Response>
      }
    }
  }
}

const handler = (Route as RouteWithHandlers).options.server.handlers.GET

function makeRequest(queryPath: string | null): Request {
  const url = new URL('http://localhost/api/hermes-docs')
  if (queryPath !== null) url.searchParams.set('path', queryPath)
  return new Request(url.toString())
}

describe('/api/hermes-docs', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(isAuthenticated).mockReturnValueOnce(false)
    const res = await handler({ request: makeRequest('user-guide/docker.md') })
    expect(res.status).toBe(401)
  })

  it('returns 400 when path is missing', async () => {
    const res = await handler({ request: makeRequest(null) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns content on success', async () => {
    vi.mocked(readHermesDoc).mockReturnValueOnce({
      ok: true,
      path: 'user-guide/docker.md',
      content: '# Docker backend\n',
    })
    const res = await handler({ request: makeRequest('user-guide/docker.md') })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.content).toBe('# Docker backend\n')
    expect(body.liveUrl).toBe('https://hermes-agent.nousresearch.com/docs/user-guide/docker')
  })

  it('degrades to 200 + liveUrl when the docs directory is absent (no error)', async () => {
    vi.mocked(readHermesDoc).mockReturnValueOnce({
      ok: false,
      reason: 'no-docs-root',
      message: 'Local Hermes docs are not installed on this machine.',
    })
    const res = await handler({ request: makeRequest('user-guide/docker.md') })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.liveUrl).toBe('https://hermes-agent.nousresearch.com/docs/user-guide/docker')
  })

  it('returns 400 for a rejected traversal attempt', async () => {
    vi.mocked(readHermesDoc).mockReturnValueOnce({
      ok: false,
      reason: 'invalid-path',
      message: 'Path escapes the docs root',
    })
    const res = await handler({ request: makeRequest('../../etc/passwd') })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 404 when the doc is not found', async () => {
    vi.mocked(readHermesDoc).mockReturnValueOnce({
      ok: false,
      reason: 'not-found',
      message: 'Not found',
    })
    const res = await handler({ request: makeRequest('nope.md') })
    expect(res.status).toBe(404)
  })
})
