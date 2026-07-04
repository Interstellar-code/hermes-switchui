import { describe, expect, it } from 'vitest'

import { CANONICAL_PROVIDER_IDS, getProviderInfo } from './provider-catalog'

describe('provider-catalog', () => {
  it('includes the provider ids already referenced by gateway setup surfaces', () => {
    for (const providerId of [
      'github-copilot',
      'mistral',
      'deepseek',
      'groq',
      'xai',
      'perplexity',
      'cohere',
      'together',
      'fireworks',
      'openai-codex',
      'vertex',
    ]) {
      expect(CANONICAL_PROVIDER_IDS).toContain(providerId)
      expect(getProviderInfo(providerId)?.id).toBe(providerId)
    }
  })
})
