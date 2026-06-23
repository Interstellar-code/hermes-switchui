import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildResolvedSessionHeaders,
  readResolvedSessionHeaders,
} from './send-stream-session-headers'

describe('send-stream session headers', () => {
  it('publishes both Hermes and legacy Claude session headers for compatibility', () => {
    expect(
      buildResolvedSessionHeaders({
        sessionKey: 'sess-123',
        friendlyId: 'friendly-123',
      }),
    ).toMatchObject({
      'X-Hermes-Session-Key': 'sess-123',
      'X-Hermes-Friendly-Id': 'friendly-123',
      'x-claude-session-key': 'sess-123',
      'x-claude-friendly-id': 'friendly-123',
    })
  })

  it('prefers Hermes headers when both header families are present', () => {
    const headers = new Headers({
      'X-Hermes-Session-Key': 'sess-new',
      'X-Hermes-Friendly-Id': 'friendly-new',
      'x-claude-session-key': 'sess-old',
      'x-claude-friendly-id': 'friendly-old',
    })

    expect(
      readResolvedSessionHeaders(headers, {
        sessionKey: 'fallback-session',
        friendlyId: 'fallback-friendly',
      }),
    ).toEqual({
      sessionKey: 'sess-new',
      friendlyId: 'friendly-new',
    })
  })

  it('falls back to legacy Claude headers when Hermes headers are absent', () => {
    const headers = new Headers({
      'x-claude-session-key': 'sess-legacy',
      'x-claude-friendly-id': 'friendly-legacy',
    })

    expect(
      readResolvedSessionHeaders(headers, {
        sessionKey: 'fallback-session',
        friendlyId: 'fallback-friendly',
      }),
    ).toEqual({
      sessionKey: 'sess-legacy',
      friendlyId: 'friendly-legacy',
    })
  })

  describe('friendlyId fallback warning (#134)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      warnSpy.mockRestore()
    })

    it('emits console.warn when friendly-id headers are missing and falls back to sessionKey', () => {
      const headers = new Headers({
        'X-Hermes-Session-Key': 'sess-abc',
        // No friendly-id headers at all
      })

      const result = readResolvedSessionHeaders(headers, {
        sessionKey: 'fallback-session',
        friendlyId: 'fallback-friendly',
      })

      // Fallback value is sessionKey (the resolved one), not the fallback.friendlyId
      expect(result.friendlyId).toBe('sess-abc')
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(warnSpy.mock.calls[0][0]).toContain('falling back to')
    })

    it('does NOT warn when friendly-id header is present', () => {
      const headers = new Headers({
        'X-Hermes-Session-Key': 'sess-xyz',
        'X-Hermes-Friendly-Id': 'friendly-xyz',
      })

      readResolvedSessionHeaders(headers, {
        sessionKey: 'fallback-session',
        friendlyId: 'fallback-friendly',
      })

      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('does NOT warn when legacy friendly-id header is present', () => {
      const headers = new Headers({
        'x-claude-session-key': 'sess-leg',
        'x-claude-friendly-id': 'friendly-leg',
      })

      readResolvedSessionHeaders(headers, {
        sessionKey: 'fallback-session',
        friendlyId: 'fallback-friendly',
      })

      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('falls back to fallback.friendlyId when no session key or friendly-id headers present', () => {
      const headers = new Headers()

      const result = readResolvedSessionHeaders(headers, {
        sessionKey: 'fallback-session',
        friendlyId: 'fallback-friendly',
      })

      // sessionKey falls back → friendlyId falls back to sessionKey fallback
      expect(result.sessionKey).toBe('fallback-session')
      expect(result.friendlyId).toBe('fallback-session')
      expect(warnSpy).toHaveBeenCalledOnce()
    })
  })
})
