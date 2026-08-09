// @vitest-environment jsdom
/**
 * The half of the gate that touches the browser. `onboarding-gate.test.ts`
 * covers the pure reducer; what is asserted here is the persistence contract
 * around the connection probe, which has to satisfy two things that pull in
 * opposite directions:
 *
 *   - an unauthenticated visitor's probe must never leave anything behind
 *     (it used to stamp the completion flag, consuming first-run setup for
 *     whoever logged in next), and
 *   - an install with a working gateway must not repaint the fullscreen
 *     wizard on every single boot and then have it vanish once the probe
 *     resolves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { ONBOARDING_KEYS } from './onboarding-storage'
import { useOnboardingGate } from './use-onboarding-gate'

function configuredResponse() {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true }),
  } as Response)
}

describe('useOnboardingGate — auto-detection persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('persists an auto-detection so the next boot does not flash the wizard', async () => {
    const fetchMock = vi.fn(() => configuredResponse())
    vi.stubGlobal('fetch', fetchMock)

    const first = renderHook(() => useOnboardingGate({ probe: true }))
    await waitFor(() => expect(first.result.current.gate.complete).toBe(true))

    expect(localStorage.getItem(ONBOARDING_KEYS.autoDetected)).toBeTruthy()
    // Not the completion flag: a machine noticing is not a human finishing.
    expect(localStorage.getItem(ONBOARDING_KEYS.complete)).toBeNull()

    first.unmount()
    fetchMock.mockClear()

    // Second boot: complete from hydration alone, so the fullscreen wizard
    // never gets a frame, and rule 1 (no probe once settled) keeps holding.
    const second = renderHook(() => useOnboardingGate({ probe: true }))
    await waitFor(() => expect(second.result.current.hydrated).toBe(true))
    expect(second.result.current.gate.complete).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('writes nothing when the probe is disabled — the unauthenticated path', async () => {
    const fetchMock = vi.fn(() => configuredResponse())
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useOnboardingGate({ probe: false }))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(ONBOARDING_KEYS.autoDetected)).toBeNull()
    expect(localStorage.getItem(ONBOARDING_KEYS.complete)).toBeNull()
    expect(result.current.gate.complete).toBe(false)
  })

  it('does not persist a detection that lost the race to the user', async () => {
    // A probe that resolves outside the grace window settles nothing, so
    // remembering it would claim more than was observed.
    let resolveProbe: (value: Response) => void = () => undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveProbe = resolve
          }),
      ),
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      const { result } = renderHook(() => useOnboardingGate({ probe: true }))
      await waitFor(() => expect(result.current.hydrated).toBe(true))

      vi.setSystemTime(Date.now() + 10_000)
      resolveProbe({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      } as Response)

      await vi.waitFor(() =>
        expect(localStorage.getItem(ONBOARDING_KEYS.autoDetected)).toBeNull(),
      )
      expect(result.current.gate.complete).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
