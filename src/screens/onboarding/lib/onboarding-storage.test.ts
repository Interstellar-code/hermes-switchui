import { describe, expect, it } from 'vitest'

import {
  ONBOARDING_DRAFT_VERSION,
  ONBOARDING_KEYS,
  clearOnboardingDraft,
  readOnboardingAutoDetected,
  readOnboardingDraft,
  readOnboardingOutcome,
  sanitizeDraftForStorage,
  writeOnboardingAutoDetected,
  writeOnboardingComplete,
  writeOnboardingDismissed,
  writeOnboardingDraft,
} from './onboarding-storage'
import type { OnboardingDraft, OnboardingTransient } from './onboarding-storage'

function baseDraft(): OnboardingDraft {
  return {
    version: ONBOARDING_DRAFT_VERSION,
    branch: 'main',
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
      branch: 'main',
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
    writeOnboardingComplete(storage, { branch: 'main', skipped: ['verify'] })
    expect(readOnboardingOutcome(storage)).toEqual({
      kind: 'complete',
      at: expect.any(Number),
      branch: 'main',
      skipped: ['verify'],
      completed: [],
    })
  })

  it('round-trips the completed list, which the badge and palette read', () => {
    const storage = new MemoryStorage()
    writeOnboardingComplete(storage, {
      branch: 'main',
      skipped: ['verify'],
      completed: ['provider', 'plugins', 'theme'],
    })
    const outcome = readOnboardingOutcome(storage)
    expect(outcome).toMatchObject({
      kind: 'complete',
      completed: ['provider', 'plugins', 'theme'],
    })
  })

  it('a record written before `completed` existed still reads as complete', () => {
    // Tolerant, not versioned: treating the missing field as a shape mismatch
    // would collapse the record to `fresh` and re-onboard the install.
    const storage = new MemoryStorage()
    storage.setItem(
      ONBOARDING_KEYS.outcome,
      JSON.stringify({
        kind: 'complete',
        at: 5,
        branch: 'main',
        skipped: ['theme'],
      }),
    )
    expect(readOnboardingOutcome(storage)).toEqual({
      kind: 'complete',
      at: 5,
      branch: 'main',
      skipped: ['theme'],
      completed: [],
    })
  })
})

describe('the auto-detected record', () => {
  it('round-trips, and is a separate key from the completion flag', () => {
    const storage = new MemoryStorage()
    writeOnboardingAutoDetected(storage)

    const record = readOnboardingAutoDetected(storage)
    expect(record?.kind).toBe('auto-detected')
    expect(record?.at).toBeGreaterThan(0)

    // Critically: an auto-detection is not a claim that a human finished
    // setup, so it must not stamp the flag the rest of the app reads.
    expect(storage.getItem(ONBOARDING_KEYS.complete)).toBeNull()
    expect(readOnboardingOutcome(storage)).toEqual({ kind: 'fresh' })
  })

  it('reads as null with no record, null storage, or corrupt JSON', () => {
    expect(readOnboardingAutoDetected(null)).toBeNull()
    expect(readOnboardingAutoDetected(new MemoryStorage())).toBeNull()

    const storage = new MemoryStorage()
    storage.setItem(ONBOARDING_KEYS.autoDetected, '{not json')
    expect(() => readOnboardingAutoDetected(storage)).not.toThrow()
    expect(readOnboardingAutoDetected(storage)).toBeNull()
  })

  it('writeOnboardingComplete also stamps the legacy complete key', () => {
    const storage = new MemoryStorage()
    writeOnboardingComplete(storage, { branch: 'main', skipped: [] })
    expect(storage.getItem(ONBOARDING_KEYS.complete)).toBe('true')
    expect(ONBOARDING_KEYS.complete).toBe('claude-onboarding-complete')
  })
})
