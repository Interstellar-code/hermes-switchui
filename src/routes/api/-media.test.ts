import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression tests for #146: /api/media must reject paths outside the
 * permitted roots (HERMES_HOME/uploads and project files/).
 */

let tmpHermesHome: string
let tmpFilesDir: string
let originalHermesHome: string | undefined
let originalClaudeHome: string | undefined
let originalCwd: () => string

beforeEach(() => {
  tmpHermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'media-test-hermes-'))
  const tmpFilesParent = fs.mkdtempSync(path.join(os.tmpdir(), 'media-test-files-'))
  originalHermesHome = process.env.HERMES_HOME
  originalClaudeHome = process.env.CLAUDE_HOME
  originalCwd = process.cwd.bind(process)
  process.env.HERMES_HOME = tmpHermesHome
  delete process.env.CLAUDE_HOME

  fs.mkdirSync(path.join(tmpHermesHome, 'uploads'), { recursive: true })
  fs.writeFileSync(path.join(tmpHermesHome, 'uploads', 'allowed.png'), 'PNG')

  // Create files/ dir inside cwd() parent so it matches the "files" allowed root
  const filesDir = path.join(tmpFilesParent, 'files')
  fs.mkdirSync(filesDir, { recursive: true })
  fs.writeFileSync(path.join(filesDir, 'workspace.txt'), 'workspace')
  tmpFilesDir = filesDir

  // Override process.cwd so getAllowedMediaRoots() picks up tmpFilesParent + /files
  process.cwd = () => tmpFilesParent
})

afterEach(() => {
  process.cwd = originalCwd
  fs.rmSync(tmpHermesHome, { recursive: true, force: true })
  // Remove tmpFilesDir's parent (which contains the 'files' dir we created)
  fs.rmSync(path.dirname(tmpFilesDir), { recursive: true, force: true })
  if (originalHermesHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = originalHermesHome
  if (originalClaudeHome === undefined) delete process.env.CLAUDE_HOME
  else process.env.CLAUDE_HOME = originalClaudeHome
  vi.restoreAllMocks()
})

function makeInvoke() {
  vi.resetModules()
  vi.doMock('../../server/auth-middleware', () => ({
    isAuthenticated: (req: Request) => req.headers.get('x-test-auth') === '1',
  }))
  return async (
    queryPath: string | null,
    opts: { authenticated?: boolean } = {},
  ): Promise<Response> => {
    const mod: any = await import('./media')
    const handler = mod.Route.options.server.handlers.GET as (ctx: {
      request: Request
    }) => Promise<Response>

    const url = new URL('http://localhost/api/media')
    if (queryPath !== null) url.searchParams.set('path', queryPath)
    const headers: Record<string, string> = {}
    if (opts.authenticated !== false) headers['x-test-auth'] = '1'
    return handler({ request: new Request(url.toString(), { headers }) })
  }
}

describe('/api/media (#146 path containment)', () => {
  it('returns 401 when unauthenticated', async () => {
    const invoke = makeInvoke()
    const res = await invoke(path.join(tmpHermesHome, 'uploads', 'allowed.png'), {
      authenticated: false,
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 when path parameter is missing', async () => {
    const invoke = makeInvoke()
    const res = await invoke(null)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('serves a file inside HERMES_HOME/uploads', async () => {
    const invoke = makeInvoke()
    const res = await invoke(path.join(tmpHermesHome, 'uploads', 'allowed.png'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
  })

  it('serves a file inside project files/ directory', async () => {
    const invoke = makeInvoke()
    const res = await invoke(path.join(tmpFilesDir, 'workspace.txt'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
  })

  it('returns 403 for absolute path outside permitted roots', async () => {
    const evilFile = path.join(os.tmpdir(), 'evil-secret.txt')
    fs.writeFileSync(evilFile, 'secret')
    try {
      const invoke = makeInvoke()
      const res = await invoke(evilFile)
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.ok).toBe(false)
      expect(body.error).toBe('Path not permitted')
    } finally {
      if (fs.existsSync(evilFile)) fs.unlinkSync(evilFile)
    }
  })

  it('returns 403 for path traversal from uploads root', async () => {
    const invoke = makeInvoke()
    const res = await invoke(
      path.join(tmpHermesHome, 'uploads', '..', 'forbidden.txt'),
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 403 for path traversal from files root', async () => {
    const invoke = makeInvoke()
    const res = await invoke(path.join(tmpFilesDir, '..', 'outside.txt'))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 404 for permitted path that does not exist', async () => {
    const invoke = makeInvoke()
    const res = await invoke(path.join(tmpHermesHome, 'uploads', 'missing.png'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 when path resolves to a directory', async () => {
    const invoke = makeInvoke()
    const res = await invoke(tmpFilesDir)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })
})
