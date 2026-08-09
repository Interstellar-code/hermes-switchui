// @vitest-environment node
/**
 * The contract this module exists to keep: a configured workspace can describe
 * itself, a broken or absent config never throws, and no fact ever carries a
 * credential. That last one is not theoretical — `/api/claude-config` returns
 * `config.model.api_key` in plaintext on inline-model installs (the shape this
 * very machine uses), so every fixture here carries a real-looking key and the
 * assertions run against the serialized output, the same way
 * `onboarding-storage.test.ts` proves the draft never persists one.
 */
import { describe, expect, it } from 'vitest'
import { buildCurrentSetup, factsForStep } from './current-setup'
import type { CurrentSetup } from './current-setup'
import type { CorePluginRow } from './core-plugins'
import type { OnboardingStepId } from './onboarding-steps'
import type { SystemCheck } from './system-checks'

const SECRET = 'sk-live-do-not-leak-0987654321'

const CONFIG = {
  config: {
    model: {
      provider: 'custom',
      base_url: 'https://interstellar-llm.example/v1',
      api_key: SECRET,
      default: 'auto',
    },
  },
  activeProvider: 'custom',
  activeModel: 'openrouter/nvidia/nemotron-x',
  providers: [
    {
      id: 'anthropic',
      configured: true,
      maskedKeys: { ANTHROPIC_API_KEY: 'sk-…4321' },
    },
    { id: 'openai', configured: false, maskedKeys: {} },
    // Needs no credential at all — `configured` is true because nothing is
    // missing, not because a key is stored.
    { id: 'ollama', configured: true, maskedKeys: {} },
    { id: 'nous', configured: true, maskedKeys: { 'auth-store': 'nous-…' } },
  ],
}

const CHECKS: Array<SystemCheck> = [
  {
    id: 'gateway',
    label: 'Gateway reachable',
    status: 'ok',
    detail: 'The gateway responded to a health check.',
    heal: null,
  },
  {
    id: 'capabilities',
    label: 'Capability summary',
    status: 'ok',
    detail: '6 of 6 enhanced capabilities are on: sessions, skills.',
    heal: null,
  },
]

function pluginRow(name: string, state: CorePluginRow['state']): CorePluginRow {
  return {
    name,
    label: name,
    purpose: 'p',
    unlocks: null,
    state,
    action: 'none',
    cliCommand: null,
  }
}

const PLUGIN_ROWS: Array<CorePluginRow> = [
  pluginRow('kanban', 'enabled'),
  pluginRow('projects', 'enabled'),
  pluginRow('personas', 'disabled'),
  // This app's own row — never part of the tally.
  pluginRow('hermes-switch-ui', 'self'),
]

function configured(): CurrentSetup {
  return buildCurrentSetup({
    config: CONFIG,
    pluginRows: PLUGIN_ROWS,
    checks: CHECKS,
    themeId: 'claude-nous',
    verifyOutcome: { status: 'confirmed', modelCount: 42, message: 'ok' },
    gatewayUrl: 'http://127.0.0.1:8642',
  })
}

function fresh(overrides?: { config?: unknown }): CurrentSetup {
  return buildCurrentSetup({
    config: overrides && 'config' in overrides ? overrides.config : null,
    pluginRows: [],
    checks: [],
    themeId: 'matrix',
    verifyOutcome: null,
  })
}

const ALL_STEPS: Array<OnboardingStepId> = [
  'summary',
  'welcome',
  'system-check',
  'provider',
  'connect',
  'review',
  'verify',
  'plugins',
  'theme',
  'finish',
]

describe('buildCurrentSetup', () => {
  it('reads a fully configured workspace', () => {
    const setup = configured()

    // `custom` is the gateway's reserved legacy id for the endpoint the UI
    // writes as `manifest`, and the picker has no card for it.
    expect(setup.activeProviderId).toBe('manifest')
    expect(setup.activeProviderName).toBe('Custom (OpenAI-compatible)')
    // The provider prefix litellm adds internally is not part of the model id.
    expect(setup.activeModel).toBe('nvidia/nemotron-x')
    expect(setup.themeLabel).toBe('Nous')
    expect(setup.enabledPlugins).toEqual(['kanban', 'projects'])
    expect(setup.corePluginCount).toBe(3)
    expect(setup.connectionLabel).toBe('Hermes gateway · 6 of 6 capabilities')
    expect(setup.gatewayUrl).toBe('http://127.0.0.1:8642')
    expect(setup.verifiedModelCount).toBe(42)
    expect(setup.anythingConfigured).toBe(true)
  })

  it('counts a provider as configured only when it really is', () => {
    const setup = configured()
    expect(setup.configuredProviderIds).toEqual(['anthropic', 'ollama', 'nous'])
    expect(setup.configuredProviderIds).not.toContain('openai')
  })

  it('records where a key lives, and never that one exists when it does not', () => {
    const setup = configured()
    expect(setup.storedKeyEnvs.anthropic).toBe('ANTHROPIC_API_KEY')
    expect(setup.storedKeyEnvs.nous).toBe('auth-store')
    // Configured, but needs no credential — claiming a stored key here would
    // tell the user to leave a field blank that has never been filled.
    expect(setup.storedKeyEnvs.ollama).toBeUndefined()
  })

  it('reads the inline model block as the active provider definition', () => {
    const setup = configured()
    expect(setup.providerBaseUrls.manifest).toBe(
      'https://interstellar-llm.example/v1',
    )
    expect(setup.providerModels.manifest).toBe('nvidia/nemotron-x')
  })

  it('reads a providers map and a custom_providers array too', () => {
    const setup = buildCurrentSetup({
      config: {
        config: {
          providers: {
            OpenRouter: { base_url: 'https://or.example/v1', model: 'auto' },
          },
          custom_providers: [
            { id: 'groq', base_url: 'https://groq.example/v1' },
          ],
        },
        activeProvider: 'openrouter',
        activeModel: 'auto',
        providers: [],
      },
      pluginRows: [],
      checks: [],
      themeId: 'matrix',
      verifyOutcome: null,
    })
    expect(setup.providerBaseUrls.openrouter).toBe('https://or.example/v1')
    expect(setup.providerBaseUrls.groq).toBe('https://groq.example/v1')
  })

  it('falls back to plain reachability when no capability summary landed', () => {
    const setup = buildCurrentSetup({
      config: CONFIG,
      pluginRows: [],
      checks: [CHECKS[0]],
      themeId: 'matrix',
      verifyOutcome: null,
    })
    expect(setup.connectionLabel).toBe('Hermes gateway · reachable')
  })

  it('reports no verified count until verification is actually confirmed', () => {
    const setup = buildCurrentSetup({
      config: CONFIG,
      pluginRows: [],
      checks: [],
      themeId: 'matrix',
      verifyOutcome: {
        status: 'pending-restart',
        modelCount: 3,
        message: 'restart',
      },
    })
    expect(setup.verifiedModelCount).toBeNull()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not json'],
    ['a number', 7],
    ['an array', []],
    ['an empty object', {}],
    ['a 401 body', { error: 'unauthorized' }],
    ['garbage-shaped fields', { providers: 'nope', activeProvider: 42 }],
    ['null nested blocks', { config: null, providers: [null, 3, {}] }],
  ])('degrades to unset on %s config, and never throws', (_label, config) => {
    const setup = fresh({ config })
    expect(setup.activeProviderId).toBeNull()
    expect(setup.activeProviderName).toBeNull()
    expect(setup.activeModel).toBeNull()
    expect(setup.configuredProviderIds).toEqual([])
    expect(setup.storedKeyEnvs).toEqual({})
    expect(setup.anythingConfigured).toBe(false)
  })
})

describe('factsForStep', () => {
  it('returns nothing for the steps that own their own summaries', () => {
    const setup = configured()
    for (const id of ['welcome', 'summary', 'finish'] as const) {
      expect(factsForStep(id, setup)).toEqual([])
    }
  })

  it('returns nothing at all on a fresh install', () => {
    const setup = fresh()
    for (const id of ALL_STEPS) {
      expect(factsForStep(id, setup, { providerId: 'openai' })).toEqual([])
    }
  })

  it('leads the provider step with what is live', () => {
    const facts = factsForStep('provider', configured())
    expect(facts.map((entry) => [entry.label, entry.value, entry.state]))
      .toMatchInlineSnapshot(`
      [
        [
          "Active provider",
          "Custom (OpenAI-compatible)",
          "active",
        ],
        [
          "Active model",
          "nvidia/nemotron-x",
          "set",
        ],
        [
          "Also configured",
          "3 providers",
          "set",
        ],
      ]
    `)
  })

  it('keys the connect facts off the provider it is passed', () => {
    const setup = configured()

    const anthropic = factsForStep('connect', setup, {
      providerId: 'anthropic',
    })
    expect(anthropic[0]).toMatchObject({
      label: 'API key',
      value: 'Stored in ANTHROPIC_API_KEY',
      state: 'set',
    })

    const nous = factsForStep('connect', setup, { providerId: 'nous' })
    expect(nous[0].value).toBe('Stored in the gateway auth store')

    // A provider with nothing stored and nothing written has nothing to say.
    expect(factsForStep('connect', setup, { providerId: 'openai' })).toEqual([])

    // And with no provider chosen there is no question to answer.
    expect(factsForStep('connect', setup)).toEqual([])
  })

  it('resolves the connect facts through the legacy provider alias', () => {
    const facts = factsForStep('connect', configured(), {
      providerId: 'manifest',
    })
    expect(facts.map((entry) => entry.value)).toContain(
      'https://interstellar-llm.example/v1',
    )
  })

  it('frames the review step as a replacement', () => {
    const facts = factsForStep('review', configured())
    expect(facts.map((entry) => entry.label)).toEqual([
      'Replacing provider',
      'Replacing model',
    ])
  })

  it('counts core plugins without counting this app', () => {
    expect(factsForStep('plugins', configured())).toEqual([
      {
        id: 'plugins',
        label: 'Core plugins',
        value: '2 of 3 enabled',
        state: 'active',
      },
    ])
  })

  it('names the current theme', () => {
    expect(factsForStep('theme', configured())[0]).toMatchObject({
      value: 'Nous',
      state: 'active',
    })
  })

  it('leads the system check with the gateway it is talking to', () => {
    expect(
      factsForStep('system-check', configured()).map((entry) => entry.value),
    ).toEqual(['http://127.0.0.1:8642', 'Hermes gateway · 6 of 6 capabilities'])
  })

  it('never puts a credential in a fact, for any step', () => {
    const setup = configured()
    for (const id of ALL_STEPS) {
      for (const providerId of ['anthropic', 'nous', 'manifest', 'openai']) {
        const serialized = JSON.stringify(
          factsForStep(id, setup, { providerId }),
        )
        expect(serialized).not.toContain(SECRET)
        expect(serialized).not.toMatch(/sk-/)
        expect(serialized).not.toContain('api_key')
      }
    }
    // The whole derived object is handed to components, so it has to be clean
    // too — not just the facts built from it.
    expect(JSON.stringify(setup)).not.toContain(SECRET)
    expect(JSON.stringify(setup)).not.toMatch(/sk-/)
  })
})
