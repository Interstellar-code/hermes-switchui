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
  opts: { authenticated?: boolean; noRoot?: boolean } = {},
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
  // resolve to it. Create docs/ symlink inside the parent tmp dir. Skipped
  // for `noRoot` tests, which want cwd()+'/docs' to resolve to nothing at
  // all (a fresh checkout with no docs/ built yet).
  const parent = path.dirname(tmpDocsRoot)
  const docsLink = path.join(parent, 'docs')
  if (!opts.noRoot && !fs.existsSync(docsLink)) {
    fs.symlinkSync(tmpDocsRoot, docsLink)
  }
  process.cwd = () => parent

  vi.resetModules()
  vi.doMock('../../server/auth-middleware', () => ({
    isAuthenticated: () => authed,
  }))

  const mod = await import('./docs-asset')
  const handler = (
    mod.Route as unknown as {
      options: {
        server: {
          handlers: { GET: (ctx: { request: Request }) => Promise<Response> }
        }
      }
    }
  ).options.server.handlers.GET

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

  it('returns 200 with text/html content-type for .html file', async () => {
    fs.writeFileSync(
      path.join(tmpDocsRoot, 'images', 'diagram.html'),
      '<!DOCTYPE html><html><body><svg></svg></body></html>',
    )
    const res = await invoke('images/diagram.html')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
  })

  it('includes Content-Security-Policy with script-src none for .html file', async () => {
    fs.writeFileSync(
      path.join(tmpDocsRoot, 'images', 'diagram.html'),
      '<!DOCTYPE html><html><body><svg></svg></body></html>',
    )
    const res = await invoke('images/diagram.html')
    expect(res.status).toBe(200)
    const csp = res.headers.get('Content-Security-Policy')
    expect(csp).toBeTruthy()
    expect(csp).toContain("script-src 'none'")
  })

  it('includes X-Content-Type-Options: nosniff for .html file', async () => {
    fs.writeFileSync(
      path.join(tmpDocsRoot, 'images', 'diagram.html'),
      '<!DOCTYPE html><html><body><svg></svg></body></html>',
    )
    const res = await invoke('images/diagram.html')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('force-downloads .html outside diagrams/ (Content-Disposition: attachment)', async () => {
    fs.writeFileSync(
      path.join(tmpDocsRoot, 'images', 'diagram.html'),
      '<!DOCTYPE html><html><body>x</body></html>',
    )
    const res = await invoke('images/diagram.html')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
  })

  it('serves diagrams/*.html INLINE (no Content-Disposition) so the iframe renders', async () => {
    fs.mkdirSync(path.join(tmpDocsRoot, 'diagrams'), { recursive: true })
    fs.writeFileSync(
      path.join(tmpDocsRoot, 'diagrams', 'flow.html'),
      '<!DOCTYPE html><html><body>flow</body></html>',
    )
    const res = await invoke('diagrams/flow.html')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toBeNull()
  })

  it('locks down inline diagrams: CSP blocks scripts, allows Google Fonts', async () => {
    fs.mkdirSync(path.join(tmpDocsRoot, 'diagrams'), { recursive: true })
    fs.writeFileSync(
      path.join(tmpDocsRoot, 'diagrams', 'flow.html'),
      '<!DOCTYPE html><html><body>flow</body></html>',
    )
    const res = await invoke('diagrams/flow.html')
    expect(res.status).toBe(200)
    const csp = res.headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('https://fonts.googleapis.com')
    expect(csp).toContain('https://fonts.gstatic.com')
    // no script source is ever permitted
    expect(csp).not.toContain('script-src ')
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
  })

  // ── path containment ────────────────────────────────────────────────────
  // A plain string-prefix check on the un-resolved path (what this route
  // used to do) misses a symlink planted inside docs/ that points outside
  // it: the joined path *looks* contained even though the filesystem
  // resolves it elsewhere. These mirror the containment tests in
  // `server/hermes-docs.test.ts`, which established the realpath-based fix.

  it('rejects a symlinked FILE that escapes the docs root', async () => {
    const outsideDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'docs-asset-outside-'),
    )
    try {
      const secretPath = path.join(outsideDir, 'secret.png')
      fs.writeFileSync(secretPath, 'not actually a png')
      fs.symlinkSync(secretPath, path.join(tmpDocsRoot, 'escape-link.png'))

      const res = await invoke('escape-link.png')
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.ok).toBe(false)
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('rejects a path through a symlinked DIRECTORY that escapes the docs root', async () => {
    const outsideDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'docs-asset-outside-'),
    )
    try {
      fs.writeFileSync(path.join(outsideDir, 'leak.png'), 'not actually a png')
      fs.symlinkSync(outsideDir, path.join(tmpDocsRoot, 'escape-dir'))

      const res = await invoke('escape-dir/leak.png')
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.ok).toBe(false)
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('returns 400 on an absolute path', async () => {
    const res = await invoke('/etc/passwd')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('still serves a legitimate nested asset once containment is realpath-based', async () => {
    fs.mkdirSync(path.join(tmpDocsRoot, 'images', 'nested'), {
      recursive: true,
    })
    fs.writeFileSync(
      path.join(tmpDocsRoot, 'images', 'nested', 'deep.png'),
      'fine',
    )
    const res = await invoke('images/nested/deep.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
  })

  it('degrades to a clean 404 rather than throwing when the docs root is missing', async () => {
    const res = await invoke('images/test.png', { noRoot: true })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })
})
