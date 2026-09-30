import { describe, expect, it } from 'vitest'
import { resolveCrewEffectiveStatus } from './matrix3d-presence-status'

describe('resolveCrewEffectiveStatus', () => {
  it('is idle without a live session (no heuristic boost exists any more)', () => {
    expect(
      resolveCrewEffectiveStatus({ liveStatus: null, rosterStatus: 'online' }),
    ).toBe('idle')
    expect(
      resolveCrewEffectiveStatus({ liveStatus: null, rosterStatus: 'away' }),
    ).toBe('idle')
  })

  it('trusts live session status over roster status', () => {
    expect(
      resolveCrewEffectiveStatus({
        liveStatus: 'running',
        rosterStatus: 'away',
      }),
    ).toBe('working')
  })

  it('keeps offline profiles in error when no live session exists', () => {
    expect(
      resolveCrewEffectiveStatus({ liveStatus: null, rosterStatus: 'offline' }),
    ).toBe('error')
  })
})
