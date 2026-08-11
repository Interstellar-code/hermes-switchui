// @vitest-environment node
/**
 * The server half of the profile resolver.
 *
 * `session-scope` keeps its layers in module state, and on the server that
 * state is shared across every request: one user's profile written during an
 * SSR render would be read by the next user's. Every writer is therefore
 * client-only, and the snapshot the server hands React is a frozen, unscoped
 * constant — the same value the hydrating client render sees, so neither can
 * paint a concrete profile name the other disagrees with.
 *
 * `@vitest-environment node` is the point of this file: with no `window`, the
 * guards either hold or they do not.
 */
import { describe, expect, it } from 'vitest'

import {
  activeScopeKey,
  activeScopeSegments,
  getServerSessionProfileScope,
  getSessionProfile,
  getSessionProfileScope,
  profileBody,
  resolveProfile,
  setDeviceSessionProfile,
  setSessionProfile,
  syncSessionProfileToPath,
} from './session-scope'

describe('session-scope on the server', () => {
  it('refuses every write', () => {
    expect(setSessionProfile('neo')).toBe(false)
    expect(setDeviceSessionProfile('hermes-switch')).toBe(false)
    expect(getSessionProfile()).toBeNull()
  })

  it('cannot be armed by a route sync either', () => {
    // `__root` calls this during the SSR render too. It must not flip the
    // device-layer gate, or a later request on the same process would inherit
    // it.
    syncSessionProfileToPath('/chat/session-a')
    setDeviceSessionProfile('hermes-switch')
    expect(getSessionProfile()).toBeNull()
  })

  it('renders every key and body exactly as an unscoped client would', () => {
    expect(profileBody()).toEqual({})
    expect(activeScopeSegments()).toEqual([])
    expect(activeScopeKey('abc123')).toBe('abc123')
    expect(getSessionProfileScope()).toEqual({ profile: null, source: 'none' })
  })

  it('hands React a stable unscoped server snapshot', () => {
    const snapshot = getServerSessionProfileScope()
    expect(snapshot).toEqual({ profile: null, source: 'none' })
    expect(getServerSessionProfileScope()).toBe(snapshot)
  })

  it('keeps the resolver itself pure and usable', () => {
    // The rule is a pure function precisely so it can be reasoned about (and
    // tested) without the client-only module state around it.
    expect(resolveProfile({ urlProfile: 'neo', storedProfile: 'trinity' })).toEqual({
      profile: 'neo',
      source: 'url',
    })
    expect(resolveProfile({ storedProfile: 'active' }).profile).toBeNull()
    expect(resolveProfile({ storedProfile: 'default' }).profile).toBe('default')
  })
})
