import { describe, expect, it } from 'vitest'

import { buildOnboardingProviderChoices } from './provider-choices'
import {
  CANONICAL_PROVIDER_IDS,
  RESERVED_PROVIDER_ID,
  getProviderEnvKey,
} from '@/lib/provider-catalog'
import { OAUTH_SUPPORTED_PROVIDERS } from '@/screens/providers/hooks/use-nous-oauth'

describe('buildOnboardingProviderChoices', () => {
  it('covers every catalog id', () => {
    const choices = buildOnboardingProviderChoices()
    const ids = choices.map((choice) => choice.id).sort()
    expect(ids).toEqual([...CANONICAL_PROVIDER_IDS].sort())
  })

  it('excludes the reserved custom id', () => {
    const choices = buildOnboardingProviderChoices()
    expect(choices.some((choice) => choice.id === RESERVED_PROVIDER_ID)).toBe(
      false,
    )
  })

  it('every envKey matches the catalog', () => {
    const choices = buildOnboardingProviderChoices()
    for (const choice of choices) {
      expect(choice.envKey).toBe(getProviderEnvKey(choice.id))
    }
  })

  it('supportsOAuth is true only for OAUTH_SUPPORTED_PROVIDERS', () => {
    const choices = buildOnboardingProviderChoices()
    for (const choice of choices) {
      const expected = (
        OAUTH_SUPPORTED_PROVIDERS as ReadonlyArray<string>
      ).includes(choice.id)
      expect(choice.supportsOAuth).toBe(expected)
    }
  })

  it('openai-codex is the previous wizard dead end: no server oauth, but a cli command', () => {
    const choice = buildOnboardingProviderChoices().find(
      (candidate) => candidate.id === 'openai-codex',
    )
    expect(choice).toBeDefined()
    expect(choice?.supportsOAuth).toBe(false)
    expect(choice?.authKind).toBe('cli-token')
    expect(choice?.cliCommand).toBeTruthy()
  })

  it('every cli-token provider gets a non-null cliCommand and every other provider gets null', () => {
    const choices = buildOnboardingProviderChoices()
    for (const choice of choices) {
      if (choice.authKind === 'cli-token') {
        expect(choice.cliCommand).toMatch(/^claude auth login /)
      } else {
        expect(choice.cliCommand).toBeNull()
      }
    }
  })

  it('groups the free providers', () => {
    const choices = buildOnboardingProviderChoices()
    const byId = new Map(choices.map((choice) => [choice.id, choice]))
    expect(byId.get('nous')?.group).toBe('free')
    expect(byId.get('ollama')?.group).toBe('free')
    expect(byId.get('atomic-chat')?.group).toBe('free')
  })

  it('groups the popular providers', () => {
    const choices = buildOnboardingProviderChoices()
    const byId = new Map(choices.map((choice) => [choice.id, choice]))
    for (const id of [
      'anthropic',
      'openai',
      'openrouter',
      'google',
      'groq',
      'deepseek',
    ]) {
      expect(byId.get(id)?.group).toBe('popular')
    }
  })

  it('everything else falls into "all"', () => {
    const choices = buildOnboardingProviderChoices()
    const byId = new Map(choices.map((choice) => [choice.id, choice]))
    expect(byId.get('mistral')?.group).toBe('all')
    expect(byId.get('vertex')?.group).toBe('all')
  })

  it('hoists detected providers to the "detected" group with a model-count detail', () => {
    const choices = buildOnboardingProviderChoices({
      detected: [{ id: 'mistral', modelCount: 4 }],
    })
    const mistral = choices.find((choice) => choice.id === 'mistral')
    expect(mistral?.group).toBe('detected')
    expect(mistral?.detail).toBe('4 models detected')
  })

  it('falls back to a running/detected label when no model count is known', () => {
    const running = buildOnboardingProviderChoices({
      detected: [{ id: 'ollama', running: true }],
    }).find((choice) => choice.id === 'ollama')
    expect(running?.detail).toBe('Running')

    const detectedOnly = buildOnboardingProviderChoices({
      detected: [{ id: 'ollama' }],
    }).find((choice) => choice.id === 'ollama')
    expect(detectedOnly?.detail).toBe('Detected')
  })

  it('leaves detail null for anything not detected', () => {
    const choices = buildOnboardingProviderChoices()
    expect(choices.every((choice) => choice.detail === null)).toBe(true)
  })
})
