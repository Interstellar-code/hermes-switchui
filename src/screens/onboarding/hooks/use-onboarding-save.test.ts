// @vitest-environment jsdom
/**
 * The lifetime half of the save hook. The write lock itself is covered by
 * `lib/relaunch-lock.test.ts`; what is asserted here is that the 20-second
 * verify poll cannot outlive the step it belongs to.
 *
 * This hook lives on the flow component, not on the step body, so unmounting
 * the wizard is *not* the only way to leave the provider step — back, forward, or a jump
 * from the summary checklist all leave the wizard mounted and used to leave
 * `verifyProviderAfterSave` hitting /api/models every 1.5s for the rest of its
 * budget, with a stale outcome landing after the user had moved on.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useOnboardingSave } from './use-onboarding-save'
import type { OnboardingStepId } from '../lib/onboarding-steps'

const verifySignals: Array<AbortSignal | undefined> = []

vi.mock('@/screens/providers/lib/verify-provider', () => ({
  verifyProviderAfterSave: (
    _providerId: string,
    options?: { signal?: AbortSignal },
  ) => {
    verifySignals.push(options?.signal)
    // Never settles on its own: the only way this poll ends in the test is
    // the abort the hook is supposed to issue.
    return new Promise(() => undefined)
  },
}))

const restartMutate = vi.fn(() => Promise.resolve({}))

vi.mock('@/screens/providers/hooks/use-provider-mutations', () => ({
  useProviderMutations: () => ({
    restartGateway: { mutateAsync: restartMutate, isPending: false },
  }),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return React.createElement(QueryClientProvider, { client }, children)
}

function renderSave(stepId: OnboardingStepId) {
  return renderHook(
    (props: { stepId: OnboardingStepId }) =>
      useOnboardingSave({
        mode: 'first-run',
        unlocked: true,
        stepId: props.stepId,
      }),
    { wrapper, initialProps: { stepId } },
  )
}

describe('useOnboardingSave — verify poll lifetime', () => {
  afterEach(() => {
    verifySignals.length = 0
    restartMutate.mockClear()
    vi.unstubAllGlobals()
  })

  it('aborts the poll when the current step leaves the provider step', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as Response),
      ),
    )

    const { result, rerender } = renderSave('provider')

    await act(async () => {
      void result.current.verify('ollama')
      // Let the hook's state updates flush; the poll itself never settles.
      await Promise.resolve()
    })

    const signal = verifySignals.at(-1)
    expect(signal).toBeDefined()
    expect(signal!.aborted).toBe(false)

    // Back / forward / jump — the wizard stays mounted throughout.
    rerender({ stepId: 'plugins' })

    expect(signal!.aborted).toBe(true)
  })

  it('a later return to the provider step gets a fresh, un-aborted controller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as Response),
      ),
    )

    const { result, rerender } = renderSave('provider')

    await act(async () => {
      void result.current.verify('ollama')
      // Let the hook's state updates flush; the poll itself never settles.
      await Promise.resolve()
    })
    rerender({ stepId: 'workspace' })
    rerender({ stepId: 'provider' })

    await act(async () => {
      void result.current.verify('ollama')
      // Let the hook's state updates flush; the poll itself never settles.
      await Promise.resolve()
    })

    expect(verifySignals).toHaveLength(2)
    expect(verifySignals[0]!.aborted).toBe(true)
    expect(verifySignals[1]!.aborted).toBe(false)
  })

  it('offers no gateway restart while locked, and refuses one if called', async () => {
    // Same class as the plugins/system-check leak: the provider step is
    // reachable from a locked relaunch (the summary checklist links straight
    // to it), and "Restart gateway now" bounces the user's running gateway.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ dashboard: { available: true } }),
        } as Response),
      ),
    )

    const locked = renderHook(
      () =>
        useOnboardingSave({
          mode: 'relaunch',
          unlocked: false,
          stepId: 'provider',
        }),
      { wrapper },
    )
    await act(async () => {
      await locked.result.current.restart()
    })
    expect(locked.result.current.canRestart).toBe(false)
    expect(restartMutate).not.toHaveBeenCalled()

    const unlocked = renderHook(
      () =>
        useOnboardingSave({
          mode: 'relaunch',
          unlocked: true,
          stepId: 'provider',
        }),
      { wrapper },
    )
    await act(async () => {
      await unlocked.result.current.restart()
    })
    expect(restartMutate).toHaveBeenCalled()
  })

  it('still aborts on unmount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as Response),
      ),
    )

    const { result, unmount } = renderSave('provider')

    await act(async () => {
      void result.current.verify('ollama')
      // Let the hook's state updates flush; the poll itself never settles.
      await Promise.resolve()
    })
    const signal = verifySignals.at(-1)
    unmount()

    expect(signal!.aborted).toBe(true)
  })
})
