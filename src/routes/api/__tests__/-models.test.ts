import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn().mockImplementation(() => {}),
  mkdirSync: vi.fn().mockImplementation(() => {}),
  statSync: vi.fn().mockReturnValue({ isFile: () => false, mtimeMs: 0 }),
  readdirSync: vi.fn().mockReturnValue([]),
}))

vi.mock('node:fs', () => ({
  default: { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync },
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  readdirSync,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: any) => opts,
}))

vi.mock('@tanstack/react-start', () => ({
  json: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
      ...(init || {}),
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    }),
}))

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

vi.mock('../../../server/gateway-capabilities', () => ({
  BEARER_TOKEN: '',
  CLAUDE_API: 'http://127.0.0.1:8642',
}))

vi.mock('../../../server/hermes-api', () => ({
  ensureGatewayProbed: vi.fn(),
  getGatewayCapabilities: () => ({ models: false }),
}))

vi.mock('../../../server/local-provider-discovery', () => ({
  ensureDiscovery: vi.fn(),
  getDiscoveredModels: () => [],
  ensureProviderInConfig: () => false,
}))

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CLAUDE_HOME
})

describe('models route', () => {
  async function importModels() {
    vi.resetModules()
    const mod = await import('../models')
    return mod
  }

  async function getHandler() {
    const mod = await importModels()
    const get = (mod as any).Route.server.handlers.GET
    return get
  }

  it('GET returns ok:true and empty models without config', async () => {
    const get = await getHandler()
    expect(typeof get).toBe('function')
    const request = new Request('http://localhost/api/models')
    const res = await get({ request })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.data).toEqual([])
  })

  it('reads default model from CLAUDE_HOME config using YAML.parse', async () => {
    const envHome = '/mock/profiles/jarvis'
    process.env.CLAUDE_HOME = envHome

    const configYaml = 'model: jarvis-model\nprovider: nous\n'
    const modelsJson = '[{"model":"x","provider":"y"}]'
    existsSync.mockImplementation((p: string) => {
      return p === `${envHome}/models.json` || p === `${envHome}/config.yaml`
    })
    readFileSync.mockImplementation((p: string) => {
      if (p === `${envHome}/config.yaml`) return configYaml
      if (p === `${envHome}/models.json`) return modelsJson
      return ''
    })

    const get = await getHandler()
    const request = new Request('http://localhost/api/models')
    const res = await get({ request })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.models[0].id).toBe('jarvis-model')
    expect(json.models[0].provider).toBe('nous')
  })

  it('reads nested model object syntax from config using YAML.parse', async () => {
    const envHome = '/mock/profiles/jarvis'
    process.env.CLAUDE_HOME = envHome

    const configYaml = 'model:\n  default: nest-model\n  provider: anthropic\n'
    existsSync.mockImplementation((p: string) => p === `${envHome}/config.yaml`)
    readFileSync.mockImplementation((p: string) => {
      if (p === `${envHome}/config.yaml`) return configYaml
      return ''
    })

    const get = await getHandler()
    const request = new Request('http://localhost/api/models')
    const res = await get({ request })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.models[0].id).toBe('nest-model')
    expect(json.models[0].provider).toBe('anthropic')
  })

  it('profile=default resolves to the Hermes root config, not profiles/default', async () => {
    const rootHome = '/mock/root'
    process.env.CLAUDE_HOME = rootHome

    const configYaml = 'model: root-model\nprovider: root-provider\n'
    // Only the root dir and its config.yaml exist — profiles/default does not,
    // mirroring the real disk layout that caused the bug (getProfileClaudeHome
    // would have pointed at a nonexistent `profiles/default`).
    existsSync.mockImplementation((p: string) => {
      return p === rootHome || p === `${rootHome}/config.yaml`
    })
    readFileSync.mockImplementation((p: string) => {
      if (p === `${rootHome}/config.yaml`) return configYaml
      return ''
    })

    const get = await getHandler()
    const request = new Request('http://localhost/api/models?profile=default')
    const res = await get({ request })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.models[0].id).toBe('root-model')
    expect(json.models[0].provider).toBe('root-provider')
    // Never probed the nonexistent profiles/default path.
    expect(existsSync).not.toHaveBeenCalledWith(`${rootHome}/profiles/default/config.yaml`)
    expect(existsSync).not.toHaveBeenCalledWith(`${rootHome}/profiles/default`)
  })

  it('a missing profile config is reported as an error, not a successful empty catalog', async () => {
    // No profile directory and no config.yaml exist anywhere on disk.
    existsSync.mockReturnValue(false)
    readFileSync.mockReturnValue('')

    const get = await getHandler()
    const request = new Request('http://localhost/api/models?profile=ghost')
    const res = await get({ request })
    expect(res.status).not.toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.data).toEqual([])
  })
})

describe('remote model discovery (model.base_url)', () => {
  async function importModels() {
    vi.resetModules()
    const mod = await import('../models')
    return mod
  }

  async function getHandler() {
    const mod = await importModels()
    const get = (mod as any).Route.server.handlers.GET
    return get
  }

  const remoteConfigYaml = [
    'model:',
    '  provider: custom',
    '  base_url: https://interstellar-llm.tailc8d717.ts.net/v1',
    '  api_key: mnfst_secret-token',
    '  default: auto',
    '  discover_models: true',
    '  context_length: 500000',
    '',
  ].join('\n')

  const remoteHome = '/mock/root'

  function stubConfig() {
    process.env.CLAUDE_HOME = remoteHome
    existsSync.mockImplementation((p: string) => p === `${remoteHome}/config.yaml`)
    readFileSync.mockImplementation((p: string) => {
      if (p === `${remoteHome}/config.yaml`) return remoteConfigYaml
      return ''
    })
  }

  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('enumerates models from model.base_url and merges them into the catalog', async () => {
    stubConfig()
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'auto', object: 'model', created: 0, owned_by: 'manifest' },
            {
              id: 'zai/glm-4.5-subscription',
              object: 'model',
              created: 0,
              owned_by: 'manifest',
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const get = await getHandler()
    const request = new Request('http://localhost/api/models')
    const res = await get({ request })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    const ids = json.models.map((m: any) => m.id)
    expect(ids).toContain('zai/glm-4.5-subscription')

    // The fetch went to the endpoint's /models route and never leaked the
    // api_key into anything the test can observe as a log — only assert the
    // Authorization header carried it to the (mocked) network call itself.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://interstellar-llm.tailc8d717.ts.net/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mnfst_secret-token',
        }),
      }),
    )
  })

  it('keeps the existing catalog intact when the remote endpoint is unreachable', async () => {
    stubConfig()
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    const get = await getHandler()
    const request = new Request('http://localhost/api/models')
    const res = await get({ request })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    // The `auto` default model (sourced from model.default, not the remote
    // fetch) still comes through — an unreachable endpoint must not empty
    // the dropdown or fail the request.
    expect(json.models[0].id).toBe('auto')
  })

  it('caches the remote model list rather than refetching on every request', async () => {
    stubConfig()
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'zai/glm-4.5-subscription' }],
        }),
        { status: 200 },
      ),
    )

    const get = await getHandler()
    const request = new Request('http://localhost/api/models')
    const first = await get({ request })
    expect(first.status).toBe(200)
    const second = await get({ request })
    expect(second.status).toBe(200)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
