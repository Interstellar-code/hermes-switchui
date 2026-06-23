import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  hasActiveSendRun,
  registerActiveSendRun,
  unregisterActiveSendRun,
} from './send-run-tracker'

// Reset global tracker state between tests so they are isolated.
const ACTIVE_RUNS_KEY = '__claude_active_send_runs__'
function clearTracker() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any)[ACTIVE_RUNS_KEY]
}

describe('send-run-tracker', () => {
  beforeEach(() => {
    clearTracker()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    clearTracker()
  })

  it('registers a run and reports it as active', () => {
    registerActiveSendRun('run-1')
    expect(hasActiveSendRun('run-1')).toBe(true)
  })

  it('unregisters a run and it is no longer active', () => {
    registerActiveSendRun('run-2')
    unregisterActiveSendRun('run-2')
    expect(hasActiveSendRun('run-2')).toBe(false)
  })

  it('returns false for unknown run ids', () => {
    expect(hasActiveSendRun('unknown')).toBe(false)
  })

  it('handles null / undefined / empty string gracefully', () => {
    expect(hasActiveSendRun(null)).toBe(false)
    expect(hasActiveSendRun(undefined)).toBe(false)
    expect(hasActiveSendRun('')).toBe(false)
    // registerActiveSendRun with empty string should be a no-op
    registerActiveSendRun('')
    expect(hasActiveSendRun('')).toBe(false)
  })

  it('sweeps entries older than the TTL (12 min) on the next register', () => {
    registerActiveSendRun('stale-run')
    expect(hasActiveSendRun('stale-run')).toBe(true)

    // Advance past the 12-minute TTL
    vi.advanceTimersByTime(13 * 60 * 1000)

    // Registering a new run triggers the sweep
    registerActiveSendRun('fresh-run')

    expect(hasActiveSendRun('stale-run')).toBe(false)
    expect(hasActiveSendRun('fresh-run')).toBe(true)
  })

  it('does NOT sweep entries younger than the TTL', () => {
    registerActiveSendRun('young-run')

    // Advance only 5 minutes — well within the 12-minute TTL
    vi.advanceTimersByTime(5 * 60 * 1000)

    registerActiveSendRun('another-run')

    expect(hasActiveSendRun('young-run')).toBe(true)
    expect(hasActiveSendRun('another-run')).toBe(true)
  })

  it('multiple independent runs can be active simultaneously', () => {
    registerActiveSendRun('a')
    registerActiveSendRun('b')
    registerActiveSendRun('c')
    expect(hasActiveSendRun('a')).toBe(true)
    expect(hasActiveSendRun('b')).toBe(true)
    expect(hasActiveSendRun('c')).toBe(true)

    unregisterActiveSendRun('b')
    expect(hasActiveSendRun('a')).toBe(true)
    expect(hasActiveSendRun('b')).toBe(false)
    expect(hasActiveSendRun('c')).toBe(true)
  })
})
