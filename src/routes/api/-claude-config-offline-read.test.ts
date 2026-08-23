/**
 * GET /api/claude-config must keep answering from local disk when the gateway
 * is down. The payload is read out of ~/.hermes — config.yaml, .env, auth.json
 * — so the `config` capability being false says something about the GATEWAY,
 * not about what this process can see. The handler used to blank the whole
 * response on that flag, which told the onboarding checklist that a configured
 * user had no provider and no memory the moment the gateway stopped.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
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

// Hoisted and mutable so a test can flip the capability. The factory below is
// re-evaluated on every `vi.resetModules()`, but it closes over this same
// object, so the flip survives the reload.
const caps = vi.hoisted(() => ({ config: true }))

vi.mock('../../server/gateway-capabilities', () => ({
  ensureGatewayProbed: vi.fn(async () => undefined),
  getCapabilities: vi.fn(() => caps),
}))

type Handlers = {
  GET: (ctx: { request: Request }) => Promise<Response>
}

type ConfigPayload = {
  ok?: boolean
  code?: string
  capability?: string
  config: Record<string, Record<string, unknown>>
  providers: Array<{ id: string }>
  activeProvider: string
  activeModel: string
  claudeHome: string
}

let home: string

async function get(): Promise<ConfigPayload> {
  process.env.HERMES_HOME = home
  vi.resetModules()
  const mod = await import('./claude-config')
  const handlers = (
    mod.Route as unknown as { options: { server: { handlers: Handlers } } }
  ).options.server.handlers
  const response = await handlers.GET({
    request: new Request('http://localhost/api/claude-config'),
  })
  return (await response.json()) as ConfigPayload
}

function seed() {
  writeFileSync(
    join(home, 'config.yaml'),
    YAML.stringify({
      model: { provider: 'manifest', default: 'auto' },
      providers: {
        manifest: {
          type: 'openai',
          base_url: 'https://x/v1',
          key_env: 'CUSTOM_API_KEY',
          api_key: 'sk-ant-api03-THISMUSTNOTREACHTHEBROWSER0123456789',
        },
      },
      memory: { provider: 'matrix-memory', memory_enabled: true },
    }),
    'utf-8',
  )
  writeFileSync(
    join(home, '.env'),
    'CUSTOM_API_KEY=sk-custom-secret\n',
    'utf-8',
  )
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'hermes-config-offline-'))
  caps.config = true
})

afterEach(() => {
  delete process.env.HERMES_HOME
})

describe('GET /api/claude-config with the config capability unavailable', () => {
  it('still serves the config, providers and active selection read from disk', async () => {
    seed()
    caps.config = false

    const payload = await get()

    // The two fields the onboarding checklist reads. Blanking either one
    // reopens the "you have no provider / no memory" regression.
    expect(payload.config.memory.provider).toBe('matrix-memory')
    expect(payload.config.memory.memory_enabled).toBe(true)
    expect(payload.activeProvider).toBe('manifest')

    expect(payload.activeModel).toBe('auto')
    expect(payload.claudeHome).toBe(home)
    expect(payload.providers.length).toBeGreaterThan(0)
    expect(payload.providers.find((p) => p.id === 'manifest')).toBeDefined()
  })

  it('still labels the payload capability-unavailable for callers that gate on it', async () => {
    seed()
    caps.config = false

    const payload = await get()
    expect(payload.code).toBe('capability_unavailable')
    expect(payload.capability).toBe('config')
  })

  it('does not mark itself unusable while carrying a real config', async () => {
    // The annotation must not read as "there is no payload here". A caller
    // writing the obvious `if (!payload.ok) return` would otherwise discard a
    // config it can act on — the exact failure this change exists to remove.
    seed()
    caps.config = false

    const payload = await get()
    expect(payload.ok).toBe(true)
    expect(payload.activeProvider).toBe('manifest')
  })

  it('masks inline credentials on the degraded path too', async () => {
    seed()
    caps.config = false

    const payload = await get()
    const inline = payload.config.providers.manifest as Record<string, string>
    expect(inline.api_key).not.toContain('THISMUSTNOTREACHTHEBROWSER')
    expect(inline.api_key).toContain('…')
    expect(inline.key_env).toBe('CUSTOM_API_KEY')
  })

  it('omits the capability annotation when the gateway does expose config', async () => {
    seed()

    const payload = await get()
    expect(payload.code).toBeUndefined()
    expect(payload.activeProvider).toBe('manifest')
  })
})
