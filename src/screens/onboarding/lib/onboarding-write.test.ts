import { describe, expect, it } from 'vitest'

import {
  buildOnboardingPatch,
  buildOnboardingYamlPreview,
} from './onboarding-write'
import { buildOnboardingProviderChoices } from './provider-choices'
import {
  buildInlineProviderPatch,
  buildProviderPatch,
  buildSetActivePatch,
} from '@/screens/providers/lib/write-paths'

const choices = buildOnboardingProviderChoices()
const anthropic = choices.find((choice) => choice.id === 'anthropic')!
const manifest = buildOnboardingProviderChoices().find(
  (choice) => choice.id === 'manifest',
)!
const nous = choices.find((choice) => choice.id === 'nous')!

describe('buildOnboardingPatch', () => {
  it('matches buildProviderPatch exactly for the non-inline path', () => {
    const input = {
      choice: anthropic,
      baseUrl: '',
      apiKey: 'sk-ant-secret',
      defaultModel: 'claude-sonnet-4-6',
      makeActive: true,
    }
    const patch = buildOnboardingPatch(input)
    const expected = buildProviderPatch({
      id: anthropic.id,
      baseUrl: input.baseUrl,
      envKey: anthropic.envKey ?? undefined,
      apiKey: input.apiKey,
      defaultModel: input.defaultModel,
      makeActive: input.makeActive,
    })
    expect(patch).toEqual(expected)
  })

  it('matches buildInlineProviderPatch exactly when inline is set', () => {
    const input = {
      choice: manifest,
      baseUrl: 'https://interstellar-llm.example/v1',
      apiKey: 'sk-inline',
      defaultModel: 'auto',
      makeActive: false,
      inline: true,
    }
    const patch = buildOnboardingPatch(input)
    const expected = buildInlineProviderPatch({
      id: manifest.id,
      baseUrl: input.baseUrl,
      envKey: manifest.envKey ?? undefined,
      apiKey: input.apiKey,
      defaultModel: input.defaultModel,
      makeActive: input.makeActive,
    })
    expect(patch).toEqual(expected)
  })

  it('writes no providers block for an OAuth-only provider with nothing to define', () => {
    // `nous` has no catalog base URL and no env var: the gateway owns the
    // endpoint and reads the token from its own auth store. A bare
    // `providers.nous: {type: openai}` is not inert — the gateway's picker-side
    // resolver (`resolve_provider_full` → `resolve_user_provider`) gives user
    // config priority and performs no validation, so that entry replaces the
    // real OAuth definition with an api-key one whose base_url is "".
    expect(nous.baseUrl).toBeNull()
    expect(nous.envKey).toBeNull()

    const patch = buildOnboardingPatch({
      choice: nous,
      baseUrl: '',
      apiKey: '',
      defaultModel: 'auto',
      makeActive: true,
    })

    expect(patch.config).not.toHaveProperty('providers')
    expect(patch.config).toEqual(
      buildSetActivePatch(nous.id, 'auto').config as Record<string, unknown>,
    )
    expect(patch.env).toBeUndefined()
  })

  it('writes nothing at all for such a provider when it is not being activated', () => {
    const patch = buildOnboardingPatch({
      choice: nous,
      baseUrl: '',
      apiKey: '',
      defaultModel: '',
      makeActive: false,
    })
    expect(patch).toEqual({ config: {} })
  })

  it('still writes a providers block once the user supplies a base URL', () => {
    // The rule is "the entry would carry nothing", not "the provider is
    // OAuth" — a typed endpoint is real information and must survive.
    const patch = buildOnboardingPatch({
      choice: nous,
      baseUrl: 'https://inference.example/v1',
      apiKey: '',
      defaultModel: 'auto',
      makeActive: true,
    })
    expect(patch.config).toHaveProperty('providers')
  })

  it('leaves api-key providers on the providers-map path untouched', () => {
    // Guards the blast radius: anthropic resolves to `cli-token` in the
    // onboarding picker, so an auth-kind-based rule would have broken it.
    const patch = buildOnboardingPatch({
      choice: anthropic,
      baseUrl: '',
      apiKey: '',
      defaultModel: 'auto',
      makeActive: true,
    })
    expect(patch.config).toHaveProperty('providers')
  })

  it('delegates env var naming to write-paths, not a literal', () => {
    const patch = buildOnboardingPatch({
      choice: anthropic,
      baseUrl: '',
      apiKey: 'sk-ant-secret',
      defaultModel: 'auto',
      makeActive: false,
    })
    expect(Object.keys(patch.env ?? {})).toEqual([anthropic.envKey])
  })
})

describe('buildOnboardingYamlPreview', () => {
  it('config half matches JSON.stringify of the write-paths config', () => {
    const input = {
      choice: anthropic,
      baseUrl: '',
      apiKey: 'sk-ant-secret',
      defaultModel: 'auto',
      makeActive: false,
    }
    const preview = buildOnboardingYamlPreview(input)
    const expectedPatch = buildOnboardingPatch(input)
    expect(JSON.parse(preview.config)).toEqual(expectedPatch.config)
  })

  it('masks the key rather than exposing it, keyed off the real env var name', () => {
    const input = {
      choice: anthropic,
      baseUrl: '',
      apiKey: 'sk-ant-super-secret',
      defaultModel: 'auto',
      makeActive: false,
    }
    const preview = buildOnboardingYamlPreview(input)
    expect(preview.env).toBe(`${anthropic.envKey}=********`)
    expect(preview.env).not.toContain('sk-ant-super-secret')
    expect(preview.config).not.toContain('sk-ant-super-secret')
  })

  it('env half is null when no key is being written', () => {
    const preview = buildOnboardingYamlPreview({
      choice: anthropic,
      baseUrl: '',
      apiKey: '',
      defaultModel: 'auto',
      makeActive: false,
    })
    expect(preview.env).toBeNull()
  })
})
