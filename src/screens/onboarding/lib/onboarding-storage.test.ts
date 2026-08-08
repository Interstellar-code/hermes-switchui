import { describe, expect, it } from 'vitest'

import {
  ONBOARDING_DRAFT_VERSION,
  ONBOARDING_KEYS,
  clearOnboardingDraft,
  readOnboardingDraft,
  readOnboardingOutcome,
  sanitizeDraftForStorage,
  writeOnboardingComplete,
  writeOnboardingDismissed,
  writeOnboardingDraft,
} from './onboarding-storage'
import type { OnboardingDraft, OnboardingTransient } from './onboarding-storage'

function baseDraft(): OnboardingDraft {
  return {
    version: ONBOARDING_DRAFT_VERSION,
    branch: 'quick',
    stepId: 'connect',
    providerId: 'anthropic',
    baseUrl: '',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'auto',
    makeActive: true,
    themeId: null,
    skipped: [],
    completed: ['provider'],
    savedAt: 1000,
  }
}

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string) {
    this.store.set(key, value)
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
}

const SECRET_FIELDS: OnboardingTransient = {
  apiKey: 'sk-super-secret-value',
  deviceCode: 'device-code-abc',
  userCode: 'USER-CODE',
  verificationUrl: 'https://example.com/verify',
  models: ['gpt-4'],
  verifyOutcome: { status: 'confirmed' },
  systemChecks: { ok: true },
  gatewayUrlInput: 'http://127.0.0.1:8642',
}

describe('sanitizeDraftForStorage', () => {
  it('never serializes secret-bearing transient fields', () => {
    const sanitized = sanitizeDraftForStorage({
      ...baseDraft(),
      ...SECRET_FIELDS,
    })
    const serialized = JSON.stringify(sanitized)

    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain('deviceCode')
    expect(serialized).not.toContain('userCode')
    expect(serialized).not.toContain('verificationUrl')
    expect(serialized).not.toMatch(/sk-/)
  })

  it('round-trips every persisted field', () => {
    const draft = baseDraft()
    expect(sanitizeDraftForStorage({ ...draft, apiKey: 'sk-x' })).toEqual(draft)
  })
})

describe('readOnboardingDraft / writeOnboardingDraft', () => {
  it('round-trips through a storage implementation', () => {
    const storage = new MemoryStorage()
    writeOnboardingDraft(storage, { ...baseDraft(), apiKey: 'sk-x' })
    expect(readOnboardingDraft(storage)).toEqual(baseDraft())
  })

  it('clearOnboardingDraft removes the key', () => {
    const storage = new MemoryStorage()
    writeOnboardingDraft(storage, baseDraft())
    clearOnboardingDraft(storage)
    expect(readOnboardingDraft(storage)).toBeNull()
    expect(storage.getItem(ONBOARDING_KEYS.draft)).toBeNull()
  })

  it('corrupt JSON reads as null, never throws', () => {
    const storage = new MemoryStorage()
    storage.setItem(ONBOARDING_KEYS.draft, '{not json')
    expect(() => readOnboardingDraft(storage)).not.toThrow()
    expect(readOnboardingDraft(storage)).toBeNull()
  })

  it('a version mismatch discards the draft rather than migrating it', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      ONBOARDING_KEYS.draft,
      JSON.stringify({ ...baseDraft(), version: ONBOARDING_DRAFT_VERSION + 1 }),
    )
    expect(readOnboardingDraft(storage)).toBeNull()
  })

  it('null storage (SSR) reads as null', () => {
    expect(readOnboardingDraft(null)).toBeNull()
  })
})

describe('readOnboardingOutcome', () => {
  it('is fresh with null storage', () => {
    expect(readOnboardingOutcome(null)).toEqual({ kind: 'fresh' })
  })

  it('is fresh with nothing written', () => {
    expect(readOnboardingOutcome(new MemoryStorage())).toEqual({
      kind: 'fresh',
    })
  })

  it('is fresh on corrupt JSON in every key, never throws', () => {
    const storage = new MemoryStorage()
    storage.setItem(ONBOARDING_KEYS.outcome, '{not json')
    expect(() => readOnboardingOutcome(storage)).not.toThrow()
    expect(readOnboardingOutcome(storage)).toEqual({ kind: 'fresh' })
  })

  it('is fresh when the draft version does not match', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      ONBOARDING_KEYS.draft,
      JSON.stringify({ ...baseDraft(), version: 999 }),
    )
    expect(readOnboardingOutcome(storage)).toEqual({ kind: 'fresh' })
  })

  it('reports in-progress from a valid draft', () => {
    const storage = new MemoryStorage()
    writeOnboardingDraft(storage, baseDraft())
    expect(readOnboardingOutcome(storage)).toEqual({
      kind: 'in-progress',
      stepId: 'connect',
      branch: 'quick',
    })
  })

  it('reports dismissed after writeOnboardingDismissed', () => {
    const storage = new MemoryStorage()
    writeOnboardingDismissed(storage)
    const outcome = readOnboardingOutcome(storage)
    expect(outcome.kind).toBe('dismissed')
    expect((outcome as { at: number }).at).toBeGreaterThan(0)
  })

  it('reports complete after writeOnboardingComplete, and it outranks a leftover draft', () => {
    const storage = new MemoryStorage()
    writeOnboardingDraft(storage, baseDraft())
    writeOnboardingComplete(storage, { branch: 'quick', skipped: ['verify'] })
    expect(readOnboardingOutcome(storage)).toEqual({
      kind: 'complete',
      at: expect.any(Number),
      branch: 'quick',
      skipped: ['verify'],
    })
  })

  it('writeOnboardingComplete also stamps the legacy complete key', () => {
    const storage = new MemoryStorage()
    writeOnboardingComplete(storage, { branch: 'full', skipped: [] })
    expect(storage.getItem(ONBOARDING_KEYS.complete)).toBe('true')
    expect(ONBOARDING_KEYS.complete).toBe('claude-onboarding-complete')
  })
})
