import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for the /api/docs-asset route — serves doc images through an
 * auth-gated endpoint with path traversal protection.
 */

let tmpDocsRoot: string

beforeEach(() => {
  tmpDocsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-asset-test-'))
  // Write a test PNG (minimal 1x1 PNG magic bytes)
  const pngBuf = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
      '2e00000000c49444154789c6260000000000200010e2021700000000049454e44ae426082',
    'hex',
  )
  fs.mkdirSync(path.join(tmpDocsRoot, 'images'), { recursive: true })
  fs.writeFileSync(path.join(tmpDocsRoot, 'images', 'test.png'), pngBuf)
  fs.writeFileSync(path.join(tmpDocsRoot, 'images', 'icon.svg'), '<svg/>')
  vi.resetModules()
})

afterEach(() => {
  fs.rmSync(tmpDocsRoot, { recursive: true, force: true })
})

// Helper: build a Request with optional session cookie (auth bypass via header)
function makeRequest(
  queryPath: string | null,
  { authenticated = true }: { authenticated?: boolean } = {},
): Request {
  const url = new URL('http://localhost/api/docs-asset')
  if (queryPath !== null) url.searchParams.set('path', queryPath)
  const headers: Record<string, string> = {}
  if (authenticated) {
    // auth-middleware checks the session cookie; for unit tests we can't
    // easily inject a real session. We mock isAuthenticated instead.
    headers['x-test-authed'] = '1'
  }
  return new Request(url.toString(), { headers })
}

// Helper that rewires DOCS_ROOT and mocks isAuthenticated, then invokes the handler
async function invoke(
  queryPath: string | null,
  opts: { authenticated?: boolean } = {},
): Promise<Response> {
  const authed = opts.authenticated ?? true

  vi.doMock('../../server/auth-middleware', () => ({
    isAuthenticated: () => authed,
  }))

  // Also override DOCS_ROOT by mocking path resolution — instead, we patch
  // the module via a factory approach: re-import with the mocked docsRoot.
  // Because DOCS_ROOT is a module-level const, we patch process.cwd to point
  // to a temp dir that has our docs/ subfolder.
  const origCwd = process.cwd
  process.cwd = () => tmpDocsRoot.replace(/\/docs$/, '')

  // Symlink: tmpDocsRoot IS the docs folder, so we need cwd() + '/docs' to
  // resolve to it. Create docs/ symlink inside the parent tmp dir.
  const parent = path.dirname(tmpDocsRoot)
  const docsLink = path.join(parent, 'docs')
  if (!fs.existsSync(docsLink)) {
    fs.symlinkSync(tmpDocsRoot, docsLink)
  }
  process.cwd = () => parent

  vi.resetModules()
  vi.doMock('../../server/auth-middleware', () => ({
    isAuthenticated: () => authed,
  }))

  const mod = await import('./docs-asset')
  const handler = (mod.Route as unknown as { options: { server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } } } }).options.server.handlers.GET

  const request = makeRequest(queryPath, opts)
  const result = await handler({ request })
  process.cwd = origCwd
  if (fs.existsSync(docsLink)) fs.unlinkSync(docsLink)
  return result
}

describe('/api/docs-asset', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await invoke('images/test.png', { authenticated: false })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 when path parameter is missing', async () => {
    const res = await invoke(null)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 on path containing ..', async () => {
    const res = await invoke('../etc/passwd')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 415 on disallowed extension', async () => {
    fs.writeFileSync(path.join(tmpDocsRoot, 'images', 'secret.php'), '<?php')
    const res = await invoke('images/secret.php')
    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 404 when file does not exist', async () => {
    const res = await invoke('images/missing.png')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 200 with image/png content-type for a valid PNG', async () => {
    const res = await invoke('images/test.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300')
  })

  it('returns 200 with image/svg+xml content-type for SVG', async () => {
    const res = await invoke('images/icon.svg')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml')
  })
})
