// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  UNSCOPED_PROFILE,
  activeScopeKey,
  activeScopeSegments,
  getServerSessionProfileScope,
  getSessionProfile,
  getSessionProfileScope,
  isProfileScopedPath,
  normalizeProfile,
  normalizeStoredProfile,
  parseScopeKey,
  profileBody,
  resolveProfile,
  resolveSessionProfileScopeForUrl,
  scopeKey,
  scopeKeyOf,
  scopeSegments,
  setDeviceSessionProfile,
  setSessionProfile,
  subscribeSessionProfileScope,
  syncSessionProfileToPath,
} from './session-scope'

afterEach(() => {
  setSessionProfile(null)
  setDeviceSessionProfile(null)
  syncSessionProfileToPath('/dashboard')
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

  it('never invents "default" for an absent profile', () => {
    // `default` is a REAL profile under a multiplex gateway (`/p/default/`
    // answers 200). Mapping "no profile" onto it would emit a wrong prefix on
    // every unscoped request.
    expect(normalizeProfile('')).not.toBe('default')
    expect(normalizeProfile('default')).toBe('default')
  })
})

describe('normalizeStoredProfile', () => {
  it('collapses only the sentinel, never a real profile name', () => {
    expect(normalizeStoredProfile(UNSCOPED_PROFILE)).toBeNull()
    expect(normalizeStoredProfile('  active  ')).toBeNull()
    expect(normalizeStoredProfile('')).toBeNull()
    expect(normalizeStoredProfile(undefined)).toBeNull()
    expect(normalizeStoredProfile('default')).toBe('default')
    expect(normalizeStoredProfile('neo')).toBe('neo')
  })
})

// ── The resolver ────────────────────────────────────────────────────────────

describe('resolveProfile', () => {
  it('lets the URL beat the device selection', () => {
    expect(
      resolveProfile({ urlProfile: 'neo', storedProfile: 'hermes-switch' }),
    ).toEqual({ profile: 'neo', source: 'url' })
  })

  it('falls back to the device selection when the URL says nothing', () => {
    expect(
      resolveProfile({ urlProfile: undefined, storedProfile: 'hermes-switch' }),
    ).toEqual({ profile: 'hermes-switch', source: 'device' })
    expect(
      resolveProfile({ urlProfile: '  ', storedProfile: 'hermes-switch' }),
    ).toEqual({ profile: 'hermes-switch', source: 'device' })
  })

  it('is null when neither layer has anything', () => {
    expect(resolveProfile({})).toEqual({ profile: null, source: 'none' })
    expect(
      resolveProfile({ urlProfile: null, storedProfile: UNSCOPED_PROFILE }),
    ).toEqual({ profile: null, source: 'none' })
  })

  it('distinguishes unscoped from the profile literally named "default"', () => {
    // The whole hazard in one assertion: these two must never collapse, or an
    // unscoped install starts emitting `/p/default/` prefixes.
    expect(
      resolveProfile({ storedProfile: UNSCOPED_PROFILE }).profile,
    ).toBeNull()
    expect(resolveProfile({ storedProfile: 'default' })).toEqual({
      profile: 'default',
      source: 'device',
    })
    expect(resolveProfile({ urlProfile: 'default' })).toEqual({
      profile: 'default',
      source: 'url',
    })
  })

  it('drops the device layer on a route that does not allow it', () => {
    expect(
      resolveProfile({ storedProfile: 'neo', allowStored: false }),
    ).toEqual({ profile: null, source: 'none' })
    // …but never the URL layer: the chat route sets that explicitly.
    expect(
      resolveProfile({
        urlProfile: 'neo',
        storedProfile: 'trinity',
        allowStored: false,
      }),
    ).toEqual({ profile: 'neo', source: 'url' })
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

describe('device layer', () => {
  it('is inert until the route allows it', () => {
    setDeviceSessionProfile('hermes-switch')
    expect(getSessionProfile()).toBeNull()
    expect(profileBody()).toEqual({})

    syncSessionProfileToPath('/chat/session-a')
    expect(getSessionProfile()).toBe('hermes-switch')
    expect(profileBody()).toEqual({ profile: 'hermes-switch' })
  })

  it('routes the composer to the profile the sidebar selected', () => {
    // The bug this resolver replaced: the sidebar showed hermes-switch's
    // sessions while every write body went out unscoped, landing in whatever
    // profile the gateway happened to be running.
    syncSessionProfileToPath('/chat/session-a')
    setDeviceSessionProfile('hermes-switch')
    expect(profileBody()).toEqual({ profile: 'hermes-switch' })
    expect(activeScopeKey('abc123')).toBe('hermes-switch::abc123')
  })

  it('loses to a ?profile= pin and survives underneath it', () => {
    syncSessionProfileToPath('/chat/session-a')
    setDeviceSessionProfile('hermes-switch')
    setSessionProfile('neo')
    expect(getSessionProfileScope()).toEqual({
      profile: 'neo',
      source: 'url',
    })
    setSessionProfile(null)
    expect(getSessionProfileScope()).toEqual({
      profile: 'hermes-switch',
      source: 'device',
    })
  })

  it('accepts the persisted sentinel as unscoped', () => {
    syncSessionProfileToPath('/chat/session-a')
    setDeviceSessionProfile(UNSCOPED_PROFILE)
    expect(getSessionProfile()).toBeNull()
    expect(activeScopeSegments()).toEqual([])
  })

  it('notifies subscribers only when the resolved answer moves', () => {
    syncSessionProfileToPath('/chat/session-a')
    let calls = 0
    const unsubscribe = subscribeSessionProfileScope(() => {
      calls += 1
    })

    setDeviceSessionProfile('neo')
    expect(calls).toBe(1)
    setDeviceSessionProfile(' neo ')
    expect(calls).toBe(1)

    // Pinned by the URL: the device write below cannot change the answer, so
    // nothing re-renders.
    setSessionProfile('trinity')
    expect(calls).toBe(2)
    setDeviceSessionProfile('morpheus')
    expect(calls).toBe(2)

    unsubscribe()
    setSessionProfile(null)
    expect(calls).toBe(2)
  })

  it('keeps an unchanged snapshot referentially stable', () => {
    // useSyncExternalStore re-renders forever if the snapshot identity churns.
    const first = getSessionProfileScope()
    expect(getSessionProfileScope()).toBe(first)
    syncSessionProfileToPath('/chat/session-a')
    setDeviceSessionProfile('neo')
    const scoped = getSessionProfileScope()
    expect(getSessionProfileScope()).toBe(scoped)
    expect(scoped).not.toBe(first)
  })
})

describe('SSR snapshot', () => {
  it('is unscoped, stable, and never a guessed profile name', () => {
    // Server render and the hydrating client render both read this one. A
    // concrete name here would be wrong markup AND a hydration mismatch, since
    // the persisted device selection is not readable during SSR.
    syncSessionProfileToPath('/chat/session-a')
    setDeviceSessionProfile('hermes-switch')
    setSessionProfile('neo')
    expect(getServerSessionProfileScope()).toEqual({
      profile: null,
      source: 'none',
    })
    expect(getServerSessionProfileScope()).toBe(getServerSessionProfileScope())
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

  it('gates the device layer on the same allowlist', () => {
    // The floating ChatPanel renders on `/dashboard` with no `?profile=`. If a
    // persisted sidebar selection still applied there it would write into that
    // profile while showing the unscoped session — the exact hazard the guard
    // was written for, arriving through the other layer.
    setDeviceSessionProfile('hermes-switch')
    syncSessionProfileToPath('/chat/session-a')
    expect(getSessionProfile()).toBe('hermes-switch')

    syncSessionProfileToPath('/dashboard')
    expect(getSessionProfile()).toBeNull()
    expect(profileBody()).toEqual({})

    // Coming back re-enables it — the selection was suppressed, not destroyed.
    syncSessionProfileToPath('/chat/session-a')
    expect(getSessionProfile()).toBe('hermes-switch')
  })

  it('allowlists exactly the chat surface', () => {
    expect(isProfileScopedPath('/chat')).toBe(true)
    expect(isProfileScopedPath('/chat/new')).toBe(true)
    expect(isProfileScopedPath('/dashboard')).toBe(false)
    expect(isProfileScopedPath('/files')).toBe(false)
    expect(isProfileScopedPath('/profiles')).toBe(false)
    expect(isProfileScopedPath('/')).toBe(false)
  })
})

describe('resolveSessionProfileScopeForUrl', () => {
  beforeEach(() => {
    setSessionProfile(null)
    setDeviceSessionProfile(null)
    syncSessionProfileToPath('/chat/abc')
  })

  it('lets a caller-supplied URL beat the device layer', () => {
    setDeviceSessionProfile('trinity')
    expect(resolveSessionProfileScopeForUrl('neo')).toEqual({
      profile: 'neo',
      source: 'url',
    })
  })

  it('falls through to the device layer when the caller has no URL value', () => {
    setDeviceSessionProfile('trinity')
    expect(resolveSessionProfileScopeForUrl(null)).toEqual({
      profile: 'trinity',
      source: 'device',
    })
  })

  it('is unscoped when neither layer has anything', () => {
    expect(resolveSessionProfileScopeForUrl(null).profile).toBeNull()
  })

  it('does not conflate unscoped with the profile literally named default', () => {
    expect(resolveSessionProfileScopeForUrl('default')).toEqual({
      profile: 'default',
      source: 'url',
    })
    expect(resolveSessionProfileScopeForUrl(null).profile).toBeNull()
  })

  it('ignores the device layer on a route where it must not apply', () => {
    setDeviceSessionProfile('trinity')
    syncSessionProfileToPath('/dashboard')
    expect(resolveSessionProfileScopeForUrl(null).profile).toBeNull()
    // A URL pin still wins, since it is per-tab and explicit.
    expect(resolveSessionProfileScopeForUrl('neo').profile).toBe('neo')
  })
})

describe('resolveSessionProfileScopeForUrl — snapshot stability', () => {
  beforeEach(() => {
    setSessionProfile(null)
    setDeviceSessionProfile(null)
    syncSessionProfileToPath('/chat/abc')
  })

  // useSyncExternalStore compares snapshots by identity. An uncached snapshot
  // makes every render look like a change and hangs React outright.
  it('returns the identical object for unchanged inputs', () => {
    setDeviceSessionProfile('trinity')
    expect(resolveSessionProfileScopeForUrl('neo')).toBe(
      resolveSessionProfileScopeForUrl('neo'),
    )
    expect(resolveSessionProfileScopeForUrl(null)).toBe(
      resolveSessionProfileScopeForUrl(null),
    )
  })

  it('returns a new answer once the device layer moves underneath it', () => {
    setDeviceSessionProfile('trinity')
    const before = resolveSessionProfileScopeForUrl(null)
    setDeviceSessionProfile('morpheus')
    const after = resolveSessionProfileScopeForUrl(null)
    expect(before).not.toBe(after)
    expect(after.profile).toBe('morpheus')
  })
})

describe('resolveSessionProfileScopeForUrl — substitutes the URL input', () => {
  beforeEach(() => {
    setSessionProfile(null)
    setDeviceSessionProfile(null)
    syncSessionProfileToPath('/chat/abc')
  })

  // The whole reason this function exists. If its body ever rebinds to the
  // module's own `urlProfile` slot instead of the caller's argument, it
  // silently reads the stale value it was written to bypass — and most tests
  // would not notice, because the two usually agree.
  it("uses the caller's URL value, not the module's own slot", () => {
    setSessionProfile('morpheus') // the module slot
    expect(resolveSessionProfileScopeForUrl('neo')).toEqual({
      profile: 'neo',
      source: 'url',
    })
  })

  it('treats a caller with no URL value as unpinned even when the slot is set', () => {
    setSessionProfile('morpheus')
    setDeviceSessionProfile('trinity')
    expect(resolveSessionProfileScopeForUrl(null)).toEqual({
      profile: 'trinity',
      source: 'device',
    })
  })
})
