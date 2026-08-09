import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } =
  vi.hoisted(() => ({
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn().mockImplementation(() => {}),
    mkdirSync: vi.fn().mockImplementation(() => {}),
    renameSync: vi.fn().mockImplementation(() => {}),
  }))

vi.mock('node:fs', () => ({
  default: { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync },
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
}))

const { homedir } = vi.hoisted(() => ({
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}))

vi.mock('node:os', () => ({
  default: { homedir },
  homedir,
}))

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CLAUDE_HOME
  delete process.env.CLAUDE_API_URL
  delete process.env.CLAUDE_DASHBOARD_URL
  // HERMES_* take precedence over CLAUDE_* in the resolver, so clear them too —
  // a local .env setting HERMES_API_URL would otherwise leak into these tests
  // and report source 'env' instead of 'default'.
  delete process.env.HERMES_HOME
  delete process.env.HERMES_API_URL
  delete process.env.HERMES_DASHBOARD_URL
  delete process.env.HERMES_API_TOKEN
  delete process.env.HERMES_DASHBOARD_TOKEN
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function loadMod() {
  vi.resetModules()
  return import('../gateway-capabilities')
}

describe('gateway-capabilities', () => {
  it('default port is 8642', async () => {
    const mod = await loadMod()
    expect(mod.CLAUDE_API).toBe('http://127.0.0.1:8642')
  })

  it('setGatewayUrl mutates CLAUDE_API in-process', async () => {
    const mod = await loadMod()
    mod.setGatewayUrl('http://tailscale:9999')
    expect(mod.CLAUDE_API).toBe('http://tailscale:9999')
  })

  it('setGatewayUrl persists to switchui .env (not workspace-overrides.json)', async () => {
    const mod = await loadMod()
    mod.setGatewayUrl('http://tailscale:9999')
    // Must write to a path ending in .env, never workspace-overrides.json
    const calls = writeFileSync.mock.calls.filter(
      (c: Array<string>) => c[0].endsWith('.env'),
    )
    expect(calls.length).toBeGreaterThan(0)
    const overridesCalls = writeFileSync.mock.calls.filter(
      (c: Array<string>) => c[0].includes('workspace-overrides.json'),
    )
    expect(overridesCalls.length).toBe(0)
  })

  it('setGatewayUrl(null) reverts CLAUDE_API to env/default', async () => {
    const mod = await loadMod()
    mod.setGatewayUrl('http://tailscale:9999')
    expect(mod.CLAUDE_API).toBe('http://tailscale:9999')

    const fallback = mod.setGatewayUrl(null)
    expect(fallback).toBe('http://127.0.0.1:8642')
    expect(mod.CLAUDE_API).toBe('http://127.0.0.1:8642')
  })

  it('respects CLAUDE_API_URL env when no override', async () => {
    process.env.CLAUDE_API_URL = 'http://localhost:9000'
    const mod = await loadMod()
    expect(mod.CLAUDE_API).toBe('http://localhost:9000')
  })

  it('getResolvedUrls reports default source when no env or file override', async () => {
    const mod = await loadMod()
    const resolved = mod.getResolvedUrls()
    expect(resolved.gateway).toBe('http://127.0.0.1:8642')
    expect(resolved.source).toBe('default')
  })

  describe('isLocalhostDeployment', () => {
    afterEach(() => {
      delete process.env.HOST
    })

    it('returns true for default loopback URLs with no HOST', async () => {
      const mod = await loadMod()
      expect(mod.isLocalhostDeployment()).toBe(true)
    })

    it('returns false when HOST is bound to 0.0.0.0', async () => {
      process.env.HOST = '0.0.0.0'
      const mod = await loadMod()
      expect(mod.isLocalhostDeployment()).toBe(false)
    })

    it('returns true when HOST is loopback', async () => {
      process.env.HOST = '127.0.0.1'
      const mod = await loadMod()
      expect(mod.isLocalhostDeployment()).toBe(true)
    })

    it('returns false when gateway URL is rewritten to a non-loopback host', async () => {
      const mod = await loadMod()
      // Use the runtime setter to bypass env-var loading paths that the
      // pre-existing CLAUDE_API_URL test (above) shows are not reliable in
      // vitest's resetModules cycle.
      mod.setGatewayUrl('http://10.0.0.5:8642')
      try {
        expect(mod.isLocalhostDeployment()).toBe(false)
      } finally {
        mod.setGatewayUrl(null)
      }
    })
  })

  describe('dashboardFetch', () => {
    it('classifies timeout failures without retrying', async () => {
      process.env.HERMES_DASHBOARD_TOKEN = 'dashboard-token'
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
      const mod = await loadMod()

      const response = await mod.dashboardFetch('/api/plugins/test/timeout')

      expect(response.status).toBe(503)
      expect(response.headers.get('x-hermes-dashboard-error')).toBe('timeout')
      await expect(response.json()).resolves.toMatchObject({
        mode: 'dashboard-unavailable',
        reason: 'timeout',
      })
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/plugins/test/timeout')),
      ).toHaveLength(1)
    })

    it('never retries mutations after a transport failure', async () => {
      process.env.HERMES_DASHBOARD_TOKEN = 'dashboard-token'
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
      const mod = await loadMod()

      const response = await mod.dashboardFetch('/api/config', { method: 'POST' })

      expect(response.status).toBe(503)
      expect(response.headers.get('x-hermes-dashboard-error')).toBe('network-or-auth')
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) =>
            String(url).endsWith('/api/config') && init?.method === 'POST',
        ),
      ).toHaveLength(1)
    })

    it('refreshes its token once after a 401', async () => {
      let tokenRequest = 0
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
        if (String(url) === 'http://127.0.0.1:9119/') {
          tokenRequest += 1
          return Promise.resolve(
            new Response(
              `<script>window.__HERMES_SESSION_TOKEN__="token-${tokenRequest}"</script>`,
            ),
          )
        }
        if (String(url).endsWith('/api/plugins/workflow-engine/definitions')) {
          const token = new Headers(init?.headers).get('Authorization')
          return Promise.resolve(new Response(null, { status: token === 'Bearer token-2' ? 200 : 401 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })
      const mod = await loadMod()

      const response = await mod.dashboardFetch('/api/plugins/workflow-engine/definitions')

      expect(response.status).toBe(200)
      expect(tokenRequest).toBe(2)
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).endsWith('/api/plugins/workflow-engine/definitions'),
        ),
      ).toHaveLength(2)
    })

    it('does not replace or retry caller-provided authorization', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status: 401 }),
      )
      const mod = await loadMod()

      const response = await mod.dashboardFetch('/api/plugins/test/caller-auth', {
        headers: { Authorization: 'Bearer caller-token' },
      })

      expect(response.status).toBe(401)
      const callerRequests = fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/api/plugins/test/caller-auth'),
      )
      expect(callerRequests).toHaveLength(1)
      expect(new Headers(callerRequests[0]?.[1]?.headers).get('Authorization')).toBe(
        'Bearer caller-token',
      )
    })

    it('keeps public dashboard availability when token discovery fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        const value = String(url)
        if (value.endsWith('/api/status')) {
          return Promise.resolve(Response.json({ version: '0.18.0' }))
        }
        if (value === 'http://127.0.0.1:9119/') {
          return Promise.reject(new Error('token unavailable'))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })
      const mod = await loadMod()

      const capabilities = await mod.probeGateway({ force: true })

      expect(capabilities.dashboard.available).toBe(true)
    })
  })

  describe('probeHealth / health 401 (W3 audit item 5)', () => {
    it('a 401 on /health is NOT healthy — a token mismatch must not render as "Connected"', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        const value = String(url)
        if (value.endsWith('/health')) {
          return Promise.resolve(new Response(null, { status: 401 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })
      const mod = await loadMod()

      const capabilities = await mod.probeGateway({ force: true })

      expect(capabilities.health).toBe(false)
      expect(capabilities.authError).toBe(true)
    })

    it('a 404 on /health is unhealthy but NOT an auth error', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        const value = String(url)
        if (value.endsWith('/health')) {
          return Promise.resolve(new Response(null, { status: 404 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })
      const mod = await loadMod()

      const capabilities = await mod.probeGateway({ force: true })

      expect(capabilities.health).toBe(false)
      expect(capabilities.authError).toBe(false)
    })

    it('a 200 on /health is healthy with no auth error', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        const value = String(url)
        if (value.endsWith('/health')) {
          return Promise.resolve(new Response(null, { status: 200 }))
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })
      const mod = await loadMod()

      const capabilities = await mod.probeGateway({ force: true })

      expect(capabilities.health).toBe(true)
      expect(capabilities.authError).toBe(false)
    })
  })
})
