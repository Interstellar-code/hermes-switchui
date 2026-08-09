/**
 * The precedence table is the product here, so it is tested as a table.
 *
 * Each case below corresponds to a specific line of gateway source, cited in
 * the test name or a comment. If the gateway changes one of them, the matching
 * row fails — which is the only way a TypeScript mirror of a Python resolver
 * can be kept honest.
 */
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SECRET_FILE_MODE,
  collectCredentialStatuses,
  readAuthStore,
  readInlineConfigFacts,
  removeCredential,
  resolveCredentialStatus,
  saveCredential,
  scrubConfigMirrors,
} from './credential-status'
import type { CredentialFacts } from './credential-status'

/** All-absent baseline; each test flips only the facts it is about. */
function facts(overrides: Partial<CredentialFacts> = {}): CredentialFacts {
  return {
    key: 'OPENAI_API_KEY',
    scope: 'root',
    shape: 'providers-map',
    multiplex: false,
    inEnvFile: false,
    inShellEnv: false,
    inlineConfig: false,
    oauth: false,
    pool: false,
    ...overrides,
  }
}

describe('resolveCredentialStatus — precedence', () => {
  // runtime_provider.py:674-679 — `resolved = getenv(key_env) or entry.api_key`
  it('providers-map: env beats inline, and the inline copy is not the winner', () => {
    const status = resolveCredentialStatus(
      facts({ shape: 'providers-map', inEnvFile: true, inlineConfig: true }),
    )
    expect(status.origin).toBe('env-file')
    expect(status.shadowedBy).toBeUndefined()
    expect(status.effectiveOrigin).toBe('env-file')
  })

  // runtime_provider.py:1017-1020 — candidates are [explicit, api_key, getenv]
  // THE INVERSION: the same two stores, the opposite answer.
  it('legacy-inline: inline beats env, so the .env row is shadowed', () => {
    const status = resolveCredentialStatus(
      facts({ shape: 'legacy-inline', inEnvFile: true, inlineConfig: true }),
    )
    expect(status.origin).toBe('env-file')
    expect(status.shadowedBy).toBe('inline-config')
    expect(status.effectiveOrigin).toBe('inline-config')
    expect(status.detail).toMatch(/which wins/i)
  })

  it('the inversion is the only difference between the two shapes', () => {
    const input = { inEnvFile: true, inlineConfig: true } as const
    const modern = resolveCredentialStatus(
      facts({ ...input, shape: 'providers-map' }),
    )
    const legacy = resolveCredentialStatus(
      facts({ ...input, shape: 'legacy-inline' }),
    )
    expect(modern.origin).toBe(legacy.origin)
    expect(modern.effectiveOrigin).not.toBe(legacy.effectiveOrigin)
  })

  // `_try_resolve_from_custom_pool` returns before any key candidate is read
  // (runtime_provider.py:993), on BOTH shapes.
  it('the credential pool outranks every file, on either shape', () => {
    for (const shape of ['providers-map', 'legacy-inline'] as const) {
      const status = resolveCredentialStatus(
        facts({ shape, inEnvFile: true, inlineConfig: true, pool: true }),
      )
      expect(status.shadowedBy).toBe('pool')
      expect(status.effectiveOrigin).toBe('pool')
    }
  })

  it('a lone env-file copy resolves cleanly with no warning', () => {
    const status = resolveCredentialStatus(facts({ inEnvFile: true }))
    expect(status.origin).toBe('env-file')
    expect(status.shadowedBy).toBeUndefined()
    expect(status.detail).toBeUndefined()
  })

  it('.env beats a shell export — env_loader loads it with override=True', () => {
    const status = resolveCredentialStatus(
      facts({ inEnvFile: true, inShellEnv: true }),
    )
    expect(status.origin).toBe('env-file')
    expect(status.shadowedBy).toBeUndefined()
  })

  it('an overriding external secret source outranks .env', () => {
    const status = resolveCredentialStatus(
      facts({ inEnvFile: true, vault: true, vaultOverrides: true }),
    )
    expect(status.shadowedBy).toBe('vault')
  })

  it('a non-overriding external secret source does not', () => {
    const status = resolveCredentialStatus(
      facts({ inEnvFile: true, vault: true }),
    )
    expect(status.shadowedBy).toBeUndefined()
  })

  it('an OAuth grant outranks a manual env key on an OAuth provider', () => {
    const status = resolveCredentialStatus(
      facts({ shape: 'oauth-provider', inEnvFile: true, oauth: true }),
    )
    expect(status.shadowedBy).toBe('oauth')
  })
})

describe('resolveCredentialStatus — multiplexing', () => {
  // secret_scope.py:197-213 — get_secret reads the installed profile scope and
  // never falls through to os.environ.
  it('a shell export does not count under multiplexing', () => {
    const status = resolveCredentialStatus(
      facts({ multiplex: true, inShellEnv: true, scope: 'profile:neo' }),
    )
    expect(status.origin).toBe('none')
    expect(status.detail).toMatch(/never be used/i)
  })

  it('the same shell export DOES count when multiplexing is off', () => {
    const status = resolveCredentialStatus(facts({ inShellEnv: true }))
    expect(status.origin).toBe('env-shell')
  })

  // profiles.py:1228-1277 — a per-profile .env is a one-time copy.
  it('explains that a profile .env is not inherited from the root', () => {
    const status = resolveCredentialStatus(
      facts({ multiplex: true, scope: 'profile:neo', inEnvFile: false }),
    )
    expect(status.detail).toMatch(/copied once at profile creation/i)
  })

  it('a profile with the key in its own .env resolves normally', () => {
    const status = resolveCredentialStatus(
      facts({ multiplex: true, scope: 'profile:neo', inEnvFile: true }),
    )
    expect(status.origin).toBe('env-file')
    expect(status.scope).toBe('profile:neo')
  })
})

describe('resolveCredentialStatus — unknown vs none', () => {
  it('reports unknown, not none, when the .env could not be read', () => {
    const status = resolveCredentialStatus(facts({ inEnvFile: null }))
    expect(status.origin).toBe('unknown')
    expect(status.origin).not.toBe('none')
    expect(status.effectiveOrigin).toBe('unknown')
    expect(status.detail).toMatch(/may well be set/i)
    expect(status.unreadable).toContain('.env (dashboard unreachable)')
  })

  it('reports none only when every store answered and none had it', () => {
    const status = resolveCredentialStatus(facts())
    expect(status.origin).toBe('none')
    expect(status.unreadable).toBeUndefined()
  })

  it('still names a store it DID find, while flagging the one it could not', () => {
    const status = resolveCredentialStatus(
      facts({ inEnvFile: true, pool: null }),
    )
    expect(status.origin).toBe('env-file')
    expect(status.detail).toMatch(/could not read auth\.json/i)
  })

  it('an unreadable config.yaml is unknown, not "no inline copy"', () => {
    const status = resolveCredentialStatus(facts({ inlineConfig: null }))
    expect(status.origin).toBe('unknown')
    expect(status.unreadable).toContain('config.yaml')
  })
})

// ── Local stores ─────────────────────────────────────────────────────────────

describe('readAuthStore', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'cred-auth-'))
    process.env.HERMES_HOME = home
  })
  afterEach(() => {
    delete process.env.HERMES_HOME
  })

  /** The shape `hermes_cli/auth.py` actually writes. */
  function seedAuth(dir: string, store: unknown) {
    writeFileSync(join(dir, 'auth.json'), JSON.stringify(store), 'utf-8')
  }

  it('finds an OAuth grant under `providers`, the real key the gateway writes', () => {
    seedAuth(home, {
      version: 1,
      providers: { nous: { access_token: 'tok', expires_at: 1 } },
    })
    expect(readAuthStore('nous')).toMatchObject({ oauth: true, pool: false })
  })

  it('finds a credential-pool entry', () => {
    seedAuth(home, {
      version: 1,
      providers: {},
      credential_pool: {
        copilot: [{ id: '884c46', source: 'gh_cli', auth_type: 'api_key' }],
      },
    })
    const entry = readAuthStore('copilot')
    expect(entry).toMatchObject({ oauth: false, pool: true })
    expect(entry?.poolSources).toEqual(['gh_cli'])
  })

  // The old reader looked here, in a file the gateway has never written.
  it('does not read auth-profiles.json', () => {
    writeFileSync(
      join(home, 'auth-profiles.json'),
      JSON.stringify({ profiles: { 'nous:default': { token: 'tok' } } }),
      'utf-8',
    )
    expect(readAuthStore('nous')).toBeNull()
  })

  it('returns null — not "absent" — when no store exists at all', () => {
    expect(readAuthStore('nous')).toBeNull()
  })

  it('returns a definite negative when the store exists but has no entry', () => {
    seedAuth(home, { version: 1, providers: {} })
    expect(readAuthStore('nous')).toEqual({
      oauth: false,
      pool: false,
      scope: 'root',
      poolSources: [],
    })
  })
})

describe('readInlineConfigFacts', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'cred-cfg-'))
    process.env.HERMES_HOME = home
  })
  afterEach(() => {
    delete process.env.HERMES_HOME
  })

  it('classifies a providers entry as the env-first shape', () => {
    writeFileSync(
      join(home, 'config.yaml'),
      YAML.stringify({
        providers: {
          manifest: { base_url: 'https://x/v1', key_env: 'CUSTOM_API_KEY' },
        },
      }),
      'utf-8',
    )
    const parsed = readInlineConfigFacts()
    expect(parsed?.shapes.manifest).toBe('providers-map')
    expect(parsed?.keyEnv.manifest).toBe('CUSTOM_API_KEY')
    expect(parsed?.inlineKeyed).toEqual([])
  })

  it('classifies an inline model block as the inline-first shape', () => {
    writeFileSync(
      join(home, 'config.yaml'),
      YAML.stringify({
        model: {
          provider: 'custom',
          base_url: 'https://x/v1',
          api_key: 'sk-1',
        },
      }),
      'utf-8',
    )
    const parsed = readInlineConfigFacts()
    expect(parsed?.shapes.custom).toBe('legacy-inline')
    expect(parsed?.inlineKeyed).toContain('custom')
  })

  it('treats a missing config as "no inline keys", not unknown', () => {
    expect(readInlineConfigFacts()).toEqual({
      inlineKeyed: [],
      shapes: {},
      keyEnv: {},
      inlineValues: {},
    })
  })
})

// ── Writes ───────────────────────────────────────────────────────────────────

describe('credential writes', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'cred-write-'))
    process.env.HERMES_HOME = home
  })
  afterEach(() => {
    delete process.env.HERMES_HOME
    vi.restoreAllMocks()
  })

  /** Forces the offline path: the dashboard is not there. */
  const offline = {
    setEnv: vi.fn(async () => {
      throw new Error('dashboard unavailable')
    }),
    deleteEnv: vi.fn(async () => {
      throw new Error('dashboard unavailable')
    }),
    homeCheck: async () => true,
  }

  it('delegates to the reconciling dashboard path when it is available', async () => {
    const setEnv = vi.fn(async () => ({
      ok: true,
      key: 'OPENAI_API_KEY',
      config_updates: ['model.api_key'],
    }))
    const outcome = await saveCredential('OPENAI_API_KEY', 'sk-new', {
      setEnv,
      homeCheck: async () => true,
    })
    expect(setEnv).toHaveBeenCalledWith('OPENAI_API_KEY', 'sk-new', null)
    expect(outcome.reconciled).toBe(true)
    expect(outcome.warning).toBeUndefined()
    // The gateway's own reconciliation evidence is passed through, not assumed.
    expect(outcome.config_updates).toEqual(['model.api_key'])
  })

  it('refuses to delegate when the dashboard serves a different HERMES_HOME', async () => {
    const setEnv = vi.fn(async () => ({ ok: true }))
    const outcome = await saveCredential('OPENAI_API_KEY', 'sk-new', {
      ...offline,
      setEnv,
      homeCheck: async () => false,
    })
    expect(setEnv).not.toHaveBeenCalled()
    expect(outcome.reconciled).toBe(false)
    expect(readFileSync(join(home, '.env'), 'utf-8')).toContain('sk-new')
  })

  it('scopes the delegated write to the named profile', async () => {
    const setEnv = vi.fn(async () => ({ ok: true }))
    await saveCredential('OPENAI_API_KEY', 'sk', {
      setEnv,
      homeCheck: async () => true,
      scope: 'profile:neo',
    })
    expect(setEnv).toHaveBeenCalledWith('OPENAI_API_KEY', 'sk', 'neo')
  })

  it('says so, loudly, when it had to fall back to a local write', async () => {
    const outcome = await saveCredential('OPENAI_API_KEY', 'sk-new', offline)
    expect(outcome.reconciled).toBe(false)
    expect(outcome.warning).toMatch(/dashboard was unreachable/i)
    expect(outcome.warning).toMatch(/credential-pool/i)
  })

  it('preserves comments and unrelated lines in .env', async () => {
    writeFileSync(
      join(home, '.env'),
      '# a comment\n# OPENROUTER_API_KEY=\nOTHER=keep\n',
      'utf-8',
    )
    await saveCredential('OPENAI_API_KEY', 'sk-new', offline)
    const text = readFileSync(join(home, '.env'), 'utf-8')
    expect(text).toContain('# a comment')
    expect(text).toContain('# OPENROUTER_API_KEY=')
    expect(text).toContain('OTHER=keep')
    expect(text).toContain('OPENAI_API_KEY=sk-new')
  })

  it('replaces an `export KEY=` line rather than appending a second one', async () => {
    writeFileSync(join(home, '.env'), 'export OPENAI_API_KEY=sk-old\n', 'utf-8')
    await saveCredential('OPENAI_API_KEY', 'sk-new', offline)
    const text = readFileSync(join(home, '.env'), 'utf-8')
    expect(text).not.toContain('sk-old')
    expect(text.match(/OPENAI_API_KEY/g)).toHaveLength(1)
  })

  // ── The rotation bug, end to end (#62269) ─────────────────────────────────

  it('a rotated key leaves no stale higher-precedence copy anywhere', async () => {
    writeFileSync(join(home, '.env'), 'CUSTOM_API_KEY=sk-old\n', 'utf-8')
    writeFileSync(
      join(home, 'config.yaml'),
      YAML.stringify({
        model: {
          provider: 'custom',
          base_url: 'https://x/v1',
          // The mirror that wins on this shape, holding the OLD value.
          api_key: 'sk-old',
        },
        auxiliary: { summarize: { api_key: 'sk-old' } },
        providers: {
          manifest: { base_url: 'https://x/v1', key_env: 'CUSTOM_API_KEY' },
        },
      }),
      'utf-8',
    )

    const outcome = await saveCredential('CUSTOM_API_KEY', 'sk-new', offline)

    const config = YAML.parse(readFileSync(join(home, 'config.yaml'), 'utf-8'))
    expect(readFileSync(join(home, '.env'), 'utf-8')).toContain('sk-new')
    expect(config.model.api_key).toBe('sk-new')
    expect(config.auxiliary.summarize.api_key).toBe('sk-new')
    expect(outcome.config_updates).toEqual(
      expect.arrayContaining(['model.api_key', 'auxiliary.summarize.api_key']),
    )
    // The point of the test: nothing anywhere still holds the old secret.
    expect(readFileSync(join(home, 'config.yaml'), 'utf-8')).not.toContain(
      'sk-old',
    )
    expect(readFileSync(join(home, '.env'), 'utf-8')).not.toContain('sk-old')
  })

  it('leaves an unrelated credential with a different value alone', async () => {
    writeFileSync(join(home, '.env'), 'CUSTOM_API_KEY=sk-old\n', 'utf-8')
    writeFileSync(
      join(home, 'config.yaml'),
      YAML.stringify({
        model: { provider: 'custom', api_key: 'sk-someone-elses' },
      }),
      'utf-8',
    )
    await saveCredential('CUSTOM_API_KEY', 'sk-new', offline)
    const config = YAML.parse(readFileSync(join(home, 'config.yaml'), 'utf-8'))
    expect(config.model.api_key).toBe('sk-someone-elses')
  })

  it('a delete removes the mirror outright rather than blanking it', async () => {
    writeFileSync(join(home, '.env'), 'CUSTOM_API_KEY=sk-old\n', 'utf-8')
    writeFileSync(
      join(home, 'config.yaml'),
      YAML.stringify({ model: { provider: 'custom', api_key: 'sk-old' } }),
      'utf-8',
    )
    const outcome = await removeCredential('CUSTOM_API_KEY', offline)
    const config = YAML.parse(readFileSync(join(home, 'config.yaml'), 'utf-8'))
    expect(config.model).not.toHaveProperty('api_key')
    expect(readFileSync(join(home, '.env'), 'utf-8')).not.toContain('sk-old')
    expect(outcome.found).toBe(true)
  })

  it('scrubs the legacy `api` alias as well as `api_key`', () => {
    writeFileSync(
      join(home, 'config.yaml'),
      YAML.stringify({ model: { api: 'sk-old' } }),
      'utf-8',
    )
    expect(scrubConfigMirrors('sk-old', 'sk-new')).toEqual(['model.api'])
  })

  // ── Permissions ───────────────────────────────────────────────────────────

  it('creates .env owner-only (0600)', async () => {
    await saveCredential('OPENAI_API_KEY', 'sk-new', offline)
    const mode = statSync(join(home, '.env')).mode & 0o777
    expect(mode).toBe(SECRET_FILE_MODE)
    expect(mode).toBe(0o600)
  })

  it('tightens an existing world-readable .env on write', async () => {
    const envPath = join(home, '.env')
    writeFileSync(envPath, 'OTHER=1\n', 'utf-8')
    chmodSync(envPath, 0o644)
    await saveCredential('OPENAI_API_KEY', 'sk-new', offline)
    expect(statSync(envPath).mode & 0o777).toBe(0o600)
  })

  it('leaves a scrubbed config.yaml owner-only too', async () => {
    const configPath = join(home, 'config.yaml')
    writeFileSync(
      configPath,
      YAML.stringify({ model: { api_key: 'sk-old' } }),
      'utf-8',
    )
    chmodSync(configPath, 0o644)
    writeFileSync(join(home, '.env'), 'CUSTOM_API_KEY=sk-old\n', 'utf-8')
    await saveCredential('CUSTOM_API_KEY', 'sk-new', offline)
    expect(statSync(configPath).mode & 0o777).toBe(0o600)
  })
})

// ── Collection ───────────────────────────────────────────────────────────────

describe('collectCredentialStatuses', () => {
  const envSnapshot = {
    vars: {
      CUSTOM_API_KEY: { is_set: true, is_password: true, provider: 'custom' },
      OPENAI_API_KEY: { is_set: false, is_password: true, provider: 'openai' },
    },
  }

  it('judges each key under its own provider shape', async () => {
    const report = await collectCredentialStatuses({
      env: envSnapshot,
      oauth: { loggedIn: {}, sources: {}, previews: {} },
      inline: {
        // The real shape on a stock custom-endpoint install: an inline key in
        // `model:` plus a `providers:` entry pointing at the same env var.
        inlineKeyed: ['custom'],
        shapes: { custom: 'legacy-inline' },
        keyEnv: { custom: 'CUSTOM_API_KEY' },
        inlineValues: { custom: 'sk-inline' },
      },
      shellEnv: {},
      authStore: () => ({
        oauth: false,
        pool: false,
        scope: 'root',
        poolSources: [],
      }),
    })

    const custom = report.statuses.find((s) => s.key === 'CUSTOM_API_KEY')
    expect(custom?.origin).toBe('env-file')
    expect(custom?.shadowedBy).toBe('inline-config')
    const openai = report.statuses.find((s) => s.key === 'OPENAI_API_KEY')
    expect(openai?.origin).toBe('none')
  })

  it('reports every key as unknown — not missing — when /api/env is down', async () => {
    const report = await collectCredentialStatuses({
      keys: ['CUSTOM_API_KEY'],
      env: { vars: null, error: 'ECONNREFUSED' },
      oauth: { loggedIn: {}, sources: {}, previews: {} },
      inline: { inlineKeyed: [], shapes: {}, keyEnv: {}, inlineValues: {} },
      shellEnv: {},
      authStore: () => ({
        oauth: false,
        pool: false,
        scope: 'root',
        poolSources: [],
      }),
    })
    expect(report.unreachable[0]).toContain('/api/env')
    expect(report.statuses[0].origin).toBe('unknown')
  })

  it('surfaces an inline-only credential that has no env var at all', async () => {
    const report = await collectCredentialStatuses({
      env: { vars: {} },
      oauth: { loggedIn: {}, sources: {}, previews: {} },
      inline: {
        inlineKeyed: ['custom'],
        shapes: { custom: 'legacy-inline' },
        keyEnv: {},
        inlineValues: { custom: 'sk-inline' },
      },
      shellEnv: {},
      authStore: () => null,
    })
    const row = report.statuses.find((s) => s.key === 'inline:custom')
    expect(row?.origin).toBe('inline-config')
  })

  it('carries the multiplex flag into every row it produces', async () => {
    const report = await collectCredentialStatuses({
      multiplex: true,
      scope: 'profile:neo',
      keys: ['CUSTOM_API_KEY'],
      env: { vars: { CUSTOM_API_KEY: { is_set: false, is_password: true } } },
      oauth: { loggedIn: {}, sources: {}, previews: {} },
      inline: { inlineKeyed: [], shapes: {}, keyEnv: {}, inlineValues: {} },
      shellEnv: { CUSTOM_API_KEY: 'sk-from-shell' },
      authStore: () => ({
        oauth: false,
        pool: false,
        scope: 'profile:neo',
        poolSources: [],
      }),
    })
    // The shell has it; the gateway will never see it.
    expect(report.statuses[0].origin).toBe('none')
    expect(report.statuses[0].detail).toMatch(/never be used/i)
    expect(report.scope).toBe('profile:neo')
  })
})
