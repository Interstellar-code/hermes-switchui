/**
 * Route-level contract for /api/credentials, plus the two things GET
 * /api/claude-config was getting wrong: it shipped config.yaml (including
 * inline `api_key`) to the browser verbatim, and it looked for the auth store
 * in a file that does not exist.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => ({ options: opts }),
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(() => true),
}))

vi.mock('../../server/rate-limit', () => ({
  requireJsonContentType: vi.fn(() => null),
}))

vi.mock('../../server/gateway-capabilities', () => ({
  ensureGatewayProbed: vi.fn(async () => undefined),
  getCapabilities: vi.fn(() => ({ config: true })),
  CLAUDE_API: 'http://127.0.0.1:8642',
  CLAUDE_DASHBOARD_URL: 'http://127.0.0.1:9119',
  dashboardFetch: vi.fn(async () => new Response('{}', { status: 503 })),
}))

vi.mock('../../server/profile-scope', () => ({
  getGatewayMode: vi.fn(async () => ({
    mode: 'single',
    servedProfiles: null,
    activeProfile: 'default',
  })),
}))

// The dashboard is not reachable in a unit test, and MUST NOT be: every
// helper here would otherwise operate on the developer's real ~/.hermes.
const dashboard = vi.hoisted(() => ({
  getEnvVars: vi.fn(async () => {
    throw new Error('dashboard unavailable')
  }),
  getOAuthProviders: vi.fn(async () => {
    throw new Error('dashboard unavailable')
  }),
  setEnvVar: vi.fn(async () => ({ ok: true, key: 'K' })),
  deleteEnvVar: vi.fn(async () => ({ ok: true, key: 'K', found: true })),
  getStatus: vi.fn(async () => ({ version: '1', claude_home: '/nope' })),
  validateProviderCredential: vi.fn(async () => ({
    ok: true,
    reachable: true,
    message: '',
  })),
}))
vi.mock('../../server/claude-dashboard-api', () => dashboard)

type Handler = (ctx: { request: Request }) => Promise<Response>
type Handlers = Record<string, Handler>

let home: string

async function loadRoute(path: string): Promise<Handlers> {
  process.env.HERMES_HOME = home
  vi.resetModules()
  const mod = (await import(path)) as {
    Route: { options: { server: { handlers: Handlers } } }
  }
  return mod.Route.options.server.handlers
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cred-route-'))
  vi.clearAllMocks()
})

afterEach(() => {
  delete process.env.HERMES_HOME
})

describe('GET /api/credentials', () => {
  it('reports degraded + unknown rather than a page full of "missing"', async () => {
    writeFileSync(
      join(home, 'config.yaml'),
      YAML.stringify({
        providers: {
          manifest: { base_url: 'https://x/v1', key_env: 'CUSTOM_API_KEY' },
        },
      }),
      'utf-8',
    )
    const handlers = await loadRoute('./credentials')
    const res = await handlers.GET({
      request: new Request('http://localhost/api/credentials'),
    })
    const payload = (await res.json()) as {
      degraded: boolean
      unreachable: Array<string>
      statuses: Array<{ key: string; origin: string }>
    }
    expect(payload.degraded).toBe(true)
    expect(payload.unreachable.join(' ')).toContain('/api/env')
    const row = payload.statuses.find((s) => s.key === 'CUSTOM_API_KEY')
    expect(row?.origin).toBe('unknown')
  })

  it('rejects a traversal-shaped profile instead of joining it into a path', async () => {
    const handlers = await loadRoute('./credentials')
    const res = await handlers.GET({
      request: new Request(
        'http://localhost/api/credentials?profile=..%2F..%2Fetc',
      ),
    })
    const payload = (await res.json()) as { scope: string }
    expect(payload.scope).toBe('root')
  })
})

describe('PUT /api/credentials', () => {
  function put(body: unknown) {
    return new Request('http://localhost/api/credentials', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('blocks the save when the provider definitively rejects the key', async () => {
    dashboard.validateProviderCredential.mockResolvedValueOnce({
      ok: false,
      reachable: true,
      message: 'That API key was rejected.',
    })
    const handlers = await loadRoute('./credentials')
    const res = await handlers.PUT({
      request: put({ key: 'OPENAI_API_KEY', value: 'sk-bad', verify: true }),
    })
    expect(res.status).toBe(422)
    expect(dashboard.setEnvVar).not.toHaveBeenCalled()
  })

  it('saves anyway when the probe could not run — offline is not invalid', async () => {
    dashboard.validateProviderCredential.mockResolvedValueOnce({
      ok: false,
      reachable: false,
      message: 'Could not reach the provider.',
    })
    dashboard.getStatus.mockResolvedValueOnce({
      version: '1',
      claude_home: home,
    })
    const handlers = await loadRoute('./credentials')
    const res = await handlers.PUT({
      request: put({ key: 'OPENAI_API_KEY', value: 'sk-ok', verify: true }),
    })
    expect(res.status).toBe(200)
    expect(dashboard.setEnvVar).toHaveBeenCalled()
  })

  it('rejects a malformed env var name', async () => {
    const handlers = await loadRoute('./credentials')
    const res = await handlers.PUT({
      request: put({ key: 'not a var', value: 'x' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/claude-config', () => {
  it('masks inline credentials in the config it hands the browser', async () => {
    writeFileSync(
      join(home, 'config.yaml'),
      YAML.stringify({
        model: {
          provider: 'custom',
          base_url: 'https://interstellar-llm.example/v1',
          api_key: 'sk-ant-api03-THISMUSTNOTREACHTHEBROWSER0123456789',
          default: 'auto',
        },
        providers: {
          manifest: { base_url: 'https://x/v1', key_env: 'CUSTOM_API_KEY' },
        },
      }),
      'utf-8',
    )
    const handlers = await loadRoute('./claude-config')
    const res = await handlers.GET({
      request: new Request('http://localhost/api/claude-config'),
    })
    const body = await res.text()
    expect(body).not.toContain('THISMUSTNOTREACHTHEBROWSER')

    const payload = JSON.parse(body) as {
      config: {
        model: Record<string, string>
        providers: Record<string, Record<string, string>>
      }
    }
    // Masked, but still present and still truthy — the providers screen keys
    // "is there an inline credential?" off this field.
    expect(payload.config.model.api_key).toContain('…')
    expect(payload.config.model.api_key).toBeTruthy()
    // Not secrets, and hiding them would make the page useless: `key_env`
    // names a variable and `base_url` names an endpoint.
    expect(payload.config.providers.manifest.key_env).toBe('CUSTOM_API_KEY')
    expect(payload.config.model.base_url).toBe(
      'https://interstellar-llm.example/v1',
    )
  })

  it('finds a credential-pool entry in auth.json, which the old reader could not', async () => {
    writeFileSync(
      join(home, 'auth.json'),
      JSON.stringify({
        version: 1,
        providers: {},
        credential_pool: {
          'github-copilot': [
            { id: '884c46', source: 'gh_cli', auth_type: 'api_key' },
          ],
        },
      }),
      'utf-8',
    )
    const handlers = await loadRoute('./claude-config')
    const res = await handlers.GET({
      request: new Request('http://localhost/api/claude-config'),
    })
    const payload = (await res.json()) as {
      providers: Array<{ id: string; configured: boolean; authSource: string }>
    }
    const copilot = payload.providers.find((p) => p.id === 'github-copilot')
    expect(copilot?.configured).toBe(true)
    expect(copilot?.authSource).toBe('credential-pool')
  })
})

describe('PATCH /api/claude-config', () => {
  it('routes credential writes through the reconciling dashboard path', async () => {
    dashboard.getStatus.mockResolvedValue({ version: '1', claude_home: home })
    const { PATCH: patch } = await loadRoute('./claude-config')
    const response = await patch({
      request: new Request('http://localhost/api/claude-config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ env: { OPENAI_API_KEY: 'sk-new' } }),
      }),
    })
    const payload = (await response.json()) as {
      credentialsReconciled: boolean
    }
    expect(dashboard.setEnvVar).toHaveBeenCalledWith(
      'OPENAI_API_KEY',
      'sk-new',
      null,
    )
    expect(payload.credentialsReconciled).toBe(true)
  })

  it('falls back locally, at 0600, and warns when the dashboard is down', async () => {
    dashboard.getStatus.mockResolvedValue({ version: '1', claude_home: home })
    dashboard.setEnvVar.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const { PATCH: patch } = await loadRoute('./claude-config')
    const response = await patch({
      request: new Request('http://localhost/api/claude-config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ env: { OPENAI_API_KEY: 'sk-new' } }),
      }),
    })
    const payload = (await response.json()) as {
      credentialsReconciled: boolean
      warnings?: Array<string>
    }
    expect(payload.credentialsReconciled).toBe(false)
    expect(payload.warnings?.[0]).toMatch(/unreachable/i)
    expect(readFileSync(join(home, '.env'), 'utf-8')).toContain('sk-new')
  })
})
