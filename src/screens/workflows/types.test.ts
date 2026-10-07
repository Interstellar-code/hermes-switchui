/**
 * QA1 F1-1 / F1-2 / F1-3 regression tests — real relative times from
 * epoch-ms timestamps, and no invented versions.
 *
 * On ccdd3789 relativeTime multiplied numeric input by 1000, so a 3-minute-old
 * ms timestamp landed in the far future and every card read "just now".
 */
import { describe, expect, it } from 'vitest'
import { formatVersion, relativeTime } from './types'

describe('relativeTime — epoch-milliseconds input (QA1 F1-1)', () => {
  it('renders minutes ago for a numeric ms timestamp', () => {
    const ts = Date.now() - 3 * 60 * 1000
    expect(relativeTime(ts)).toBe('3m ago')
  })

  // QA2 NEW-1: some rows (e.g. gateway-health-check-v2) carry epoch SECONDS
  // — on e658e043 that rendered "20712d ago".
  it('treats sub-1e12 numbers as epoch seconds (QA2 NEW-1)', () => {
    const seconds = Math.floor((Date.now() - 5 * 60 * 1000) / 1000)
    expect(relativeTime(seconds)).toBe('5m ago')
    const days = Math.floor((Date.now() - 2 * 24 * 3600 * 1000) / 1000)
    expect(relativeTime(days)).toBe('2d ago')
  })

  it('still treats 1e12+ numbers as epoch milliseconds', () => {
    const ms = Date.now() - 4 * 60 * 1000
    expect(ms).toBeGreaterThan(1e12)
    expect(relativeTime(ms)).toBe('4m ago')
  })

  it('renders hours ago for a numeric ms timestamp', () => {
    const ts = Date.now() - 2 * 60 * 60 * 1000
    expect(relativeTime(ts)).toBe('2h ago')
  })

  it('renders days ago for a numeric ms timestamp', () => {
    const ts = Date.now() - 2 * 24 * 60 * 60 * 1000
    expect(relativeTime(ts)).toBe('2d ago')
  })

  it('keeps working for ISO string timestamps', () => {
    const iso = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(relativeTime(iso)).toBe('5m ago')
  })

  it('returns Never for null/undefined', () => {
    expect(relativeTime(null)).toBe('Never')
    expect(relativeTime(undefined)).toBe('Never')
  })
})

describe('formatVersion — no invented v1 (QA1 F1-3)', () => {
  it('renders v-prefixed versions', () => {
    expect(formatVersion('2')).toBe('v2')
  })

  it('renders an em dash for null and undefined instead of v1', () => {
    expect(formatVersion(null)).toBe('—')
    expect(formatVersion(undefined)).toBe('—')
  })
})
