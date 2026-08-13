import { describe, expect, it } from 'vitest'

import {
  compareAgentVersions,
  meetsAgentVersionFloor,
  parseAgentVersion,
} from './agent-version'

/**
 * The comparator is the part of the floor most likely to be silently wrong,
 * because the failing case looks fine: `"0.19.9" > "0.19.16"` is *true* as a
 * string, and a string compare would therefore wave through the exact
 * deployment this whole mechanism exists to catch. So the ordering cases below
 * lead with that pair.
 */
describe('compareAgentVersions', () => {
  it('orders 0.19.9 BELOW 0.19.16 — the case a string compare gets backwards', () => {
    const [older, floor] = ['0.19.9', '0.19.16']
    // A string compare says the old build is the newer one…
    expect(older > floor).toBe(true)
    // …which is why this is not a string compare.
    expect(compareAgentVersions('0.19.9', '0.19.16')).toBe(-1)
    expect(compareAgentVersions('0.19.16', '0.19.9')).toBe(1)
  })

  it('reports equality', () => {
    expect(compareAgentVersions('0.19.16', '0.19.16')).toBe(0)
    // A `v` prefix and build metadata take no part in precedence.
    expect(compareAgentVersions('v0.19.16', '0.19.16')).toBe(0)
    expect(compareAgentVersions('0.19.16+d3578a1', '0.19.16')).toBe(0)
    expect(compareAgentVersions('  0.19.16  ', '0.19.16')).toBe(0)
  })

  it('compares segment by segment, most significant first', () => {
    expect(compareAgentVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareAgentVersions('0.20.0', '0.19.99')).toBe(1)
    expect(compareAgentVersions('0.19.17', '0.19.16')).toBe(1)
    expect(compareAgentVersions('0.9.0', '0.10.0')).toBe(-1)
  })

  it('treats a missing trailing segment as zero', () => {
    expect(compareAgentVersions('0.19', '0.19.0')).toBe(0)
    expect(compareAgentVersions('1', '1.0.0')).toBe(0)
    expect(compareAgentVersions('0.19', '0.19.16')).toBe(-1)
  })

  it('handles more than three segments — /api/status also carries 2026.8.13.3', () => {
    expect(compareAgentVersions('2026.8.13.3', '2026.8.13.2')).toBe(1)
    expect(compareAgentVersions('2026.8.9.0', '2026.8.13.0')).toBe(-1)
    expect(compareAgentVersions('0.19.16.1', '0.19.16')).toBe(1)
  })

  it('ranks a prerelease below the release it precedes', () => {
    expect(compareAgentVersions('0.19.16-rc.1', '0.19.16')).toBe(-1)
    expect(compareAgentVersions('0.19.16', '0.19.16-rc.1')).toBe(1)
    // …but a prerelease of a HIGHER version is still higher.
    expect(compareAgentVersions('0.19.17-rc.1', '0.19.16')).toBe(1)
  })

  it('orders prerelease identifiers the semver way', () => {
    expect(compareAgentVersions('0.19.16-alpha', '0.19.16-beta')).toBe(-1)
    expect(compareAgentVersions('0.19.16-rc.1', '0.19.16-rc.2')).toBe(-1)
    // Numeric identifiers compare numerically, not as text.
    expect(compareAgentVersions('0.19.16-rc.9', '0.19.16-rc.10')).toBe(-1)
    // A numeric identifier ranks below an alphanumeric one.
    expect(compareAgentVersions('0.19.16-1', '0.19.16-alpha')).toBe(-1)
    // A shorter run of identifiers ranks below a longer one with the same prefix.
    expect(compareAgentVersions('0.19.16-rc', '0.19.16-rc.1')).toBe(-1)
    expect(compareAgentVersions('0.19.16-rc.1', '0.19.16-rc.1')).toBe(0)
  })

  it('returns null — not an ordering — for anything it cannot parse', () => {
    for (const bad of [
      null,
      undefined,
      '',
      '   ',
      'unknown',
      'latest',
      'dev',
      '0.19.x',
      'v',
      '..',
      '0.19.',
      '.19.16',
      '0,19,16',
      '0.19.16-',
      '1.0.0-rc..1',
      42,
      {},
      ['0.19.16'],
    ]) {
      expect(compareAgentVersions(bad, '0.19.16'), String(bad)).toBeNull()
      expect(compareAgentVersions('0.19.16', bad), String(bad)).toBeNull()
    }
  })
})

describe('parseAgentVersion', () => {
  it('splits the release core from the prerelease identifiers', () => {
    expect(parseAgentVersion('0.19.16')).toEqual({
      release: [0, 19, 16],
      prerelease: [],
    })
    expect(parseAgentVersion('v0.20.0-rc.2+build.7')).toEqual({
      release: [0, 20, 0],
      prerelease: ['rc', 2],
    })
  })

  it('is null for a non-string or an unparseable string', () => {
    expect(parseAgentVersion(undefined)).toBeNull()
    expect(parseAgentVersion(0.19)).toBeNull()
    expect(parseAgentVersion('0.19.16.x')).toBeNull()
  })
})

describe('meetsAgentVersionFloor', () => {
  it('is true at and above the floor', () => {
    expect(meetsAgentVersionFloor('0.19.16', '0.19.16')).toBe(true)
    expect(meetsAgentVersionFloor('0.19.17', '0.19.16')).toBe(true)
    expect(meetsAgentVersionFloor('0.20.0', '0.19.16')).toBe(true)
    expect(meetsAgentVersionFloor('1.0.0', '0.19.16')).toBe(true)
  })

  it('is false below it, including the deployment this exists for', () => {
    expect(meetsAgentVersionFloor('0.19.9', '0.19.16')).toBe(false)
    expect(meetsAgentVersionFloor('0.19.15', '0.19.16')).toBe(false)
    expect(meetsAgentVersionFloor('0.19.11', '0.19.16')).toBe(false)
  })

  it('fails CLOSED on an unknown or malformed version', () => {
    for (const bad of [null, undefined, '', '  ', 'unknown', 'latest', '0.19.x']) {
      expect(meetsAgentVersionFloor(bad, '0.19.16'), String(bad)).toBe(false)
    }
  })

  it('fails closed on a prerelease of the floor version', () => {
    // An -rc build of the floor has by definition not been measured, so
    // trusting it would be trusting a build nobody tested against.
    expect(meetsAgentVersionFloor('0.19.16-rc.1', '0.19.16')).toBe(false)
  })
})
