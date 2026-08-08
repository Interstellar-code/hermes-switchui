/**
 * Exercises DELETE /api/claude-config against a real temp HERMES_HOME, because
 * the value of this endpoint is entirely in what it leaves on disk.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
}))

type Handlers = {
  DELETE: (ctx: { request: Request }) => Promise<Response>
  PATCH: (ctx: { request: Request }) => Promise<Response>
}

let home: string

async function loadHandlers(): Promise<Handlers> {
  process.env.HERMES_HOME = home
  vi.resetModules()
  const mod = await import('./claude-config')
  return (
    mod.Route as unknown as { options: { server: { handlers: Handlers } } }
  ).options.server.handlers
}

function seed(config: Record<string, unknown>, env?: string) {
  writeFileSync(join(home, 'config.yaml'), YAML.stringify(config), 'utf-8')
  if (env !== undefined) writeFileSync(join(home, '.env'), env, 'utf-8')
}

function readBackConfig(): Record<string, unknown> {
  return YAML.parse(readFileSync(join(home, 'config.yaml'), 'utf-8')) ?? {}
}

function readBackEnv(): string {
  const path = join(home, '.env')
  return existsSync(path) ? readFileSync(path, 'utf-8') : ''
}

async function del(body: unknown) {
  const handlers = await loadHandlers()
  const response = await handlers.DELETE({
    request: new Request('http://localhost/api/claude-config', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
  return {
    response,
    payload: (await response.json()) as Record<string, unknown>,
  }
}

async function patch(body: unknown) {
  const handlers = await loadHandlers()
  const response = await handlers.PATCH({
    request: new Request('http://localhost/api/claude-config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
  return {
    response,
    payload: (await response.json()) as Record<string, unknown>,
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'hermes-delete-provider-'))
})

/**
 * A .env ships with documentation — comments, blank lines, commented-out
 * examples. Serialising a parsed key map back out silently destroyed all of
 * it the first time a user saved an API key.
 */
describe('.env editing preserves the file', () => {
  const DOCUMENTED_ENV = [
    '# Hermes Agent Environment Configuration',
    '# Get your key at: https://example.com/keys',
    '',
    '# ── LLM provider ──',
    'OPENROUTER_API_KEY=sk-existing',
    '',
    '# FIREWORKS_API_KEY=commented-out-example',
    'OTHER=keep-me',
    '',
  ].join('\n')

  it('keeps comments and blank lines when adding a key', async () => {
    seed({ providers: { manifest: {} } }, DOCUMENTED_ENV)

    await patch({ env: { GROQ_API_KEY: 'gsk-new' } })

    const env = readBackEnv()
    expect(env).toContain('# Hermes Agent Environment Configuration')
    expect(env).toContain('# ── LLM provider ──')
    expect(env).toContain('# FIREWORKS_API_KEY=commented-out-example')
    expect(env).toContain('OPENROUTER_API_KEY=sk-existing')
    expect(env).toContain('OTHER=keep-me')
    expect(env).toContain('GROQ_API_KEY=gsk-new')
  })

  it('rewrites an existing key in place without reordering the file', async () => {
    seed({ providers: { manifest: {} } }, DOCUMENTED_ENV)

    await patch({ env: { OPENROUTER_API_KEY: 'sk-rotated' } })

    const lines = readBackEnv().split('\n')
    expect(lines).toContain('OPENROUTER_API_KEY=sk-rotated')
    expect(lines).not.toContain('OPENROUTER_API_KEY=sk-existing')
    // Still the 5th line, i.e. under its own comment heading.
    expect(lines[4]).toBe('OPENROUTER_API_KEY=sk-rotated')
    expect(lines[0]).toBe('# Hermes Agent Environment Configuration')
  })

  it('deletes only the named key, leaving surrounding docs alone', async () => {
    seed({ providers: { manifest: {} } }, DOCUMENTED_ENV)

    await patch({ env: { OPENROUTER_API_KEY: '' } })

    const env = readBackEnv()
    expect(env).not.toContain('OPENROUTER_API_KEY=')
    expect(env).toContain('# ── LLM provider ──')
    expect(env).toContain('OTHER=keep-me')
  })

  it('preserves the file when a provider delete removes its key', async () => {
    seed(
      { providers: { openrouter: { key_env: 'OPENROUTER_API_KEY' } } },
      DOCUMENTED_ENV,
    )

    await del({ provider: 'openrouter', removeKey: true })

    const env = readBackEnv()
    expect(env).not.toContain('OPENROUTER_API_KEY=sk-existing')
    expect(env).toContain('# Hermes Agent Environment Configuration')
    expect(env).toContain('OTHER=keep-me')
  })
})

describe('DELETE /api/claude-config', () => {
  it('removes the provider, its custom_providers entry and its aliases', async () => {
    seed({
      model: { provider: 'openrouter', default: 'glm-4.6' },
      providers: {
        openrouter: { type: 'openai', key_env: 'OPENROUTER_API_KEY' },
        manifest: { type: 'openai', key_env: 'CUSTOM_API_KEY' },
      },
      custom_providers: [{ id: 'openrouter', models: [] }, { id: 'manifest' }],
      model_aliases: {
        fast: { provider: 'openrouter', model: 'glm-4.6' },
        slow: { provider: 'manifest', model: 'auto' },
      },
    })

    const { response, payload } = await del({ provider: 'openrouter' })
    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.removed).toBe('openrouter')

    const config = readBackConfig()
    expect(config.providers).toEqual({
      manifest: { type: 'openai', key_env: 'CUSTOM_API_KEY' },
    })
    expect(config.custom_providers).toEqual([{ id: 'manifest' }])
    expect(config.model_aliases).toEqual({
      slow: { provider: 'manifest', model: 'auto' },
    })
  })

  it('hands the active provider to a survivor rather than leaving it dangling', async () => {
    seed({
      model: { provider: 'openrouter', default: 'glm-4.6' },
      providers: { openrouter: {}, manifest: {} },
    })

    const { payload } = await del({ provider: 'openrouter' })
    expect(payload.clearedActiveProvider).toBe(true)
    expect(readBackConfig().model).toEqual({
      provider: 'manifest',
      default: 'glm-4.6',
    })
  })

  it('clears the active provider when nothing survives', async () => {
    seed({
      model: { provider: 'openrouter', default: 'glm-4.6' },
      providers: { openrouter: {} },
    })

    await del({ provider: 'openrouter' })
    const config = readBackConfig()
    expect(config.providers).toBeUndefined()
    expect(config.model).toEqual({ default: 'glm-4.6' })
  })

  it('handles the flat provider key as well as the nested model block', async () => {
    seed({
      provider: 'openrouter',
      model: 'glm-4.6',
      providers: { openrouter: {} },
    })

    const { payload } = await del({ provider: 'openrouter' })
    expect(payload.clearedActiveProvider).toBe(true)
    expect(readBackConfig()).toEqual({ model: 'glm-4.6' })
  })

  it('matches a config key whose case differs from the request', async () => {
    seed({ providers: { OpenRouter: { type: 'openai' } } })
    const { response } = await del({ provider: 'openrouter' })
    expect(response.status).toBe(200)
    expect(readBackConfig().providers).toBeUndefined()
  })

  it('leaves unrelated config untouched', async () => {
    seed({
      providers: { openrouter: {}, manifest: {} },
      memory: { enabled: true },
      agent: { max_turns: 40 },
    })

    await del({ provider: 'openrouter' })
    const config = readBackConfig()
    expect(config.memory).toEqual({ enabled: true })
    expect(config.agent).toEqual({ max_turns: 40 })
  })

  it('reports unknown providers instead of silently succeeding', async () => {
    seed({ providers: { manifest: {} } })
    const { response, payload } = await del({ provider: 'nope' })
    expect(response.status).toBe(404)
    expect(payload.ok).toBe(false)
    expect(readBackConfig().providers).toEqual({ manifest: {} })
  })

  it('rejects malformed ids', async () => {
    seed({ providers: { manifest: {} } })
    for (const provider of ['', 'has space', '-leading', '../escape']) {
      const { response } = await del({ provider })
      expect(response.status).toBe(400)
    }
  })

  it('removes the credential only when asked', async () => {
    seed(
      { providers: { openrouter: { key_env: 'OPENROUTER_API_KEY' } } },
      'OPENROUTER_API_KEY=sk-or-secret\nOTHER=keep\n',
    )

    const kept = await del({ provider: 'openrouter' })
    expect(kept.payload.removedEnvKey).toBeNull()
    expect(readBackEnv()).toContain('OPENROUTER_API_KEY=sk-or-secret')

    seed(
      { providers: { openrouter: { key_env: 'OPENROUTER_API_KEY' } } },
      'OPENROUTER_API_KEY=sk-or-secret\nOTHER=keep\n',
    )
    const removed = await del({ provider: 'openrouter', removeKey: true })
    expect(removed.payload.removedEnvKey).toBe('OPENROUTER_API_KEY')
    expect(readBackEnv()).not.toContain('OPENROUTER_API_KEY')
    expect(readBackEnv()).toContain('OTHER=keep')
  })

  it('refuses to remove a credential another provider still references', async () => {
    seed(
      {
        providers: {
          manifest: { key_env: 'CUSTOM_API_KEY' },
          'manifest-eu': { key_env: 'CUSTOM_API_KEY' },
        },
      },
      'CUSTOM_API_KEY=sk-shared\n',
    )

    const { payload } = await del({ provider: 'manifest', removeKey: true })
    expect(payload.removedEnvKey).toBeNull()
    expect(readBackEnv()).toContain('CUSTOM_API_KEY=sk-shared')
  })

  it('backs up the previous config before overwriting it', async () => {
    seed({ providers: { openrouter: {}, manifest: {} } })
    await del({ provider: 'openrouter' })

    const backup = YAML.parse(
      readFileSync(join(home, 'config.yaml.bak'), 'utf-8'),
    ) as Record<string, unknown>
    expect(backup.providers).toEqual({ openrouter: {}, manifest: {} })
  })

  it('allows emptying a config that held nothing but the provider', async () => {
    seed({ providers: { openrouter: {} } })
    const { response } = await del({ provider: 'openrouter' })
    expect(response.status).toBe(200)
    expect(readBackConfig()).toEqual({})
  })
})
