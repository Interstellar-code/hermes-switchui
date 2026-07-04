import { describe, expect, it } from 'vitest'

import { CANONICAL_PROVIDER_IDS } from '@/lib/provider-catalog'
import { KNOWN_GATEWAY_PROVIDERS } from './hub-constants'

describe('KNOWN_GATEWAY_PROVIDERS', () => {
  it('derives from the canonical provider catalog with no extra legacy aliases', () => {
    for (const providerId of CANONICAL_PROVIDER_IDS) {
      expect(KNOWN_GATEWAY_PROVIDERS).toContain(providerId)
    }
    expect(KNOWN_GATEWAY_PROVIDERS).not.toContain('google-antigravity')
  })
})
