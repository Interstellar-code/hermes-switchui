import { describe, expect, it } from 'vitest'
import { resolveCrewEffectiveStatus } from './matrix3d-presence-status'

describe('resolveCrewEffectiveStatus', () => {
  it('keeps stopped stub profiles idle even with stale heuristic boost', () => {
    expect(
      resolveCrewEffectiveStatus({
        liveStatus: null,
        rosterStatus: 'away',
        activityBoost: 6,
        processAlive: false,
        gatewayState: 'stopped',
      }),
    ).toBe('idle')
  })

  it('allows running processes to surface as working when activity is rising', () => {
    expect(
      resolveCrewEffectiveStatus({
        liveStatus: null,
        rosterStatus: 'online',
        activityBoost: 4,
        processAlive: true,
        gatewayState: 'running',
      }),
    ).toBe('working')
  })

  it('trusts live session status over roster heuristics', () => {
    expect(
      resolveCrewEffectiveStatus({
        liveStatus: 'running',
        rosterStatus: 'away',
        activityBoost: 0,
        processAlive: false,
        gatewayState: 'stopped',
      }),
    ).toBe('working')
  })

  it('keeps offline profiles in error when no live session exists', () => {
    expect(
      resolveCrewEffectiveStatus({
        liveStatus: null,
        rosterStatus: 'offline',
        activityBoost: 10,
        processAlive: false,
        gatewayState: 'stopped',
      }),
    ).toBe('error')
  })
})
