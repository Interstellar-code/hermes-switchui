// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { activeRunUrl } from './use-active-run-check'
import { setSessionProfile } from '@/lib/session-scope'

afterEach(() => {
  setSessionProfile(null)
})

describe('activeRunUrl', () => {
  it('is byte-identical to the legacy URL when unscoped', () => {
    expect(activeRunUrl('session-1')).toBe('/api/sessions/session-1/active-run')
  })

  it('carries the profile so a scoped chat reads its own run', () => {
    // Runs are persisted per session id, and ids repeat across profiles. An
    // unscoped lookup can read the other profile's run and clear (or sustain)
    // this chat's waiting state on it.
    setSessionProfile('neo')
    expect(activeRunUrl('session-1')).toBe(
      '/api/sessions/session-1/active-run?profile=neo',
    )
  })

  it('encodes both segments', () => {
    setSessionProfile('a/b')
    expect(activeRunUrl('s/1')).toBe(
      '/api/sessions/s%2F1/active-run?profile=a%2Fb',
    )
  })
})
