// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import {
  activeScopeKey,
  activeScopeSegments,
  getSessionProfile,
  normalizeProfile,
  parseScopeKey,
  scopeKey,
  scopeKeyOf,
  scopeSegments,
  setSessionProfile,
  syncSessionProfileToPath,
} from './session-scope'

afterEach(() => {
  setSessionProfile(null)
})

describe('scopeKey', () => {
  it('is byte-identical to the bare id when unscoped', () => {
    // The §2 DoD: single-profile users must keep the exact same keys.
    expect(scopeKey(null, 'abc123')).toBe('abc123')
    expect(scopeKey(undefined, 'abc123')).toBe('abc123')
    expect(scopeKey('', 'abc123')).toBe('abc123')
    expect(scopeKey('   ', 'abc123')).toBe('abc123')
  })

  it('separates the same id across profiles', () => {
    // The collision this whole phase exists to kill: one session id, two
    // profile homes, two distinct keys.
    const a = scopeKey('neo', 'abc123')
    const b = scopeKey('trinity', 'abc123')
    expect(a).not.toBe(b)
    expect(a).not.toBe(scopeKey(null, 'abc123'))
    expect(b).not.toBe(scopeKey(null, 'abc123'))
  })

  it('treats "default" as a real profile, never as unscoped', () => {
    expect(scopeKey('default', 'abc123')).toBe('default::abc123')
    expect(scopeKey('default', 'abc123')).not.toBe(scopeKey(null, 'abc123'))
  })

  it('is idempotent', () => {
    const once = scopeKey('neo', 'abc123')
    expect(scopeKey('neo', once)).toBe(once)
    expect(scopeKey('neo', scopeKey('neo', once))).toBe(once)
  })

  it('round-trips through parseScopeKey', () => {
    expect(parseScopeKey(scopeKey('neo', 'abc123'))).toEqual({
      profile: 'neo',
      sessionId: 'abc123',
    })
    expect(parseScopeKey('abc123')).toEqual({
      profile: null,
      sessionId: 'abc123',
    })
  })

  it('matches the P0A record signature', () => {
    expect(scopeKeyOf({ profile: 'neo', sessionId: 'abc123' })).toBe(
      'neo::abc123',
    )
    expect(scopeKeyOf({ profile: null, sessionId: 'abc123' })).toBe('abc123')
  })
})

describe('scopeSegments', () => {
  it('is empty when unscoped so list keys stay byte-identical', () => {
    expect(scopeSegments(null)).toEqual([])
    expect(['chat', 'sessions', ...scopeSegments(null)]).toEqual([
      'chat',
      'sessions',
    ])
  })

  it('distinguishes profiles for collection keys', () => {
    expect(['chat', 'sessions', ...scopeSegments('neo')]).not.toEqual([
      'chat',
      'sessions',
      ...scopeSegments('trinity'),
    ])
  })
})

describe('normalizeProfile', () => {
  it('collapses blanks and non-strings to null', () => {
    expect(normalizeProfile(null)).toBeNull()
    expect(normalizeProfile(undefined)).toBeNull()
    expect(normalizeProfile('')).toBeNull()
    expect(normalizeProfile('  ')).toBeNull()
    expect(normalizeProfile(42)).toBeNull()
    expect(normalizeProfile(' neo ')).toBe('neo')
  })
})

describe('ambient profile', () => {
  it('defaults to unscoped', () => {
    expect(getSessionProfile()).toBeNull()
    expect(activeScopeKey('abc123')).toBe('abc123')
    expect(activeScopeSegments()).toEqual([])
  })

  it('reports whether the value changed', () => {
    expect(setSessionProfile('neo')).toBe(true)
    expect(setSessionProfile('neo')).toBe(false)
    expect(setSessionProfile(' neo ')).toBe(false)
    expect(setSessionProfile('trinity')).toBe(true)
    expect(setSessionProfile(null)).toBe(true)
  })

  it('scopes every key built after it is set', () => {
    setSessionProfile('neo')
    expect(activeScopeKey('abc123')).toBe('neo::abc123')
    expect(activeScopeSegments()).toEqual(['neo'])
  })
})

describe('syncSessionProfileToPath', () => {
  it('drops the profile once the app leaves the chat surface', () => {
    setSessionProfile('neo')
    syncSessionProfileToPath('/dashboard')
    expect(getSessionProfile()).toBeNull()
  })

  it('keeps the profile through in-chat navigation', () => {
    // The counterpart of the retention middleware: the two must not fight. A
    // clear driven by a leave/unmount hook would fire during a chat → chat
    // swap and blank a profile the incoming route had just set. A pathname
    // check has no such moment — the path never stops being `/chat`.
    setSessionProfile('neo')
    for (const path of ['/chat/new', '/chat/session-a', '/chat/session-b']) {
      syncSessionProfileToPath(path)
      expect(getSessionProfile()).toBe('neo')
    }
  })

  it('is a no-op when already unscoped', () => {
    syncSessionProfileToPath('/files')
    expect(getSessionProfile()).toBeNull()
  })
})
