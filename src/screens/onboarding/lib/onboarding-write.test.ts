import { describe, expect, it } from 'vitest'

import {
  buildOnboardingPatch,
  buildOnboardingYamlPreview,
} from './onboarding-write'
import { buildOnboardingProviderChoices } from './provider-choices'
import {
  buildInlineProviderPatch,
  buildProviderPatch,
} from '@/screens/providers/lib/write-paths'

const choices = buildOnboardingProviderChoices()
const anthropic = choices.find((choice) => choice.id === 'anthropic')!
const manifest = buildOnboardingProviderChoices().find(
  (choice) => choice.id === 'manifest',
)!

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
