import { describe, expect, it } from 'vitest'
import { evaluateProfileServability } from './profile-servability'
import type { ProfileScopeSnapshot } from './profile-servability'

function snapshot(overrides: Partial<ProfileScopeSnapshot> = {}): ProfileScopeSnapshot {
  return {
    mode: 'single',
    servedProfiles: null,
    activeProfile: 'default',
    reason: null,
    ...overrides,
  }
}

describe('evaluateProfileServability', () => {
  it('stays silent for a single profile on disk, regardless of topology', () => {
    expect(
      evaluateProfileServability(['default'], snapshot({ mode: 'single' })),
    ).toEqual({ kind: 'ok' })
    expect(
      evaluateProfileServability(
        ['default'],
        snapshot({ mode: 'unknown', reason: 'probe-failed', activeProfile: null }),
      ),
    ).toEqual({ kind: 'ok' })
    expect(
      evaluateProfileServability(
        ['default'],
        snapshot({ mode: 'multiplex', servedProfiles: [], activeProfile: null }),
      ),
    ).toEqual({ kind: 'ok' })
  })

  it('warns when several profiles exist and the gateway is not multiplexed', () => {
    const result = evaluateProfileServability(
      ['default', 'hermes-switch'],
      snapshot({ mode: 'single', activeProfile: 'default' }),
    )
    expect(result.kind).toBe('unreachable')
    if (result.kind !== 'unreachable') throw new Error('unreachable expected')
    expect(result.unreachable).toEqual(['hermes-switch'])
    expect(result.detail).toContain('Only "default" is reachable right now')
    expect(result.detail).toContain('"hermes-switch"')
    expect(result.remediation).toContain(
      'hermes config set gateway.multiplex_profiles true',
    )
    expect(result.remediation).toContain('restart')
  })

  it('stays silent under multiplex when every disk profile is served', () => {
    const result = evaluateProfileServability(
      ['default', 'hermes-switch', 'morpheus'],
      snapshot({
        mode: 'multiplex',
        servedProfiles: ['default', 'hermes-switch', 'morpheus'],
        activeProfile: null,
      }),
    )
    expect(result).toEqual({ kind: 'ok' })
  })

  it('warns under multiplex when a disk profile is missing from served_profiles', () => {
    // The SecondaryPortBindingConfigError case: multiplex_profiles is on, the
    // gateway is healthy, but a secondary profile that wants a port-binding
    // platform got skipped at startup and never made it into served_profiles.
    const result = evaluateProfileServability(
      ['default', 'hermes-switch', 'morpheus'],
      snapshot({
        mode: 'multiplex',
        servedProfiles: ['default', 'hermes-switch'],
        activeProfile: null,
      }),
    )
    expect(result.kind).toBe('unreachable')
    if (result.kind !== 'unreachable') throw new Error('unreachable expected')
    expect(result.unreachable).toEqual(['morpheus'])
    expect(result.detail).toContain('Multiplexing is on')
    expect(result.detail).toContain('"morpheus"')
    expect(result.detail).not.toContain('multiplex_profiles true')
    expect(result.remediation).toContain('startup log')
    expect(result.remediation).toContain('"morpheus"')
  })

  it('reports probe-failed topology as non-committal, never a misconfiguration claim', () => {
    const result = evaluateProfileServability(
      ['default', 'hermes-switch'],
      snapshot({ mode: 'unknown', reason: 'probe-failed', activeProfile: null }),
    )
    expect(result.kind).toBe('indeterminate')
    if (result.kind !== 'indeterminate') throw new Error('indeterminate expected')
    expect(result.detail).toContain('could not be determined')
    expect(result.detail).not.toMatch(/misconfigur/i)
    expect(result.detail).not.toContain('multiplex_profiles true')
  })

  it('reports remote-gated topology as non-committal, distinct wording from probe-failed', () => {
    const result = evaluateProfileServability(
      ['default', 'hermes-switch'],
      snapshot({ mode: 'unknown', reason: 'remote-gated', activeProfile: null }),
    )
    expect(result.kind).toBe('indeterminate')
    if (result.kind !== 'indeterminate') throw new Error('indeterminate expected')
    expect(result.detail).toContain('gated')
    expect(result.detail).not.toMatch(/misconfigur/i)
  })

  it('reports multiple-gateways topology as non-committal too', () => {
    const result = evaluateProfileServability(
      ['default', 'hermes-switch'],
      snapshot({ mode: 'unknown', reason: 'multiple-gateways', activeProfile: null }),
    )
    expect(result.kind).toBe('indeterminate')
    if (result.kind !== 'indeterminate') throw new Error('indeterminate expected')
    expect(result.detail).toContain('several independent per-profile gateways')
  })

  it('fails closed to indeterminate if single mode ever lacks an active profile', () => {
    const result = evaluateProfileServability(
      ['default', 'hermes-switch'],
      snapshot({ mode: 'single', activeProfile: null }),
    )
    expect(result.kind).toBe('indeterminate')
  })

  it('dedupes and trims disk profile names before counting them', () => {
    expect(
      evaluateProfileServability(
        [' default ', 'default', ''],
        snapshot({ mode: 'single', activeProfile: 'default' }),
      ),
    ).toEqual({ kind: 'ok' })
  })
})
