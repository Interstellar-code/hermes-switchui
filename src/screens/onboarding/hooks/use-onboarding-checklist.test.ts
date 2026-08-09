// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- Response.json mocks intentionally match the async browser API. */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ONBOARDING_COMPLETE_EVENT,
  ONBOARDING_KEYS,
} from '../lib/onboarding-storage'
import { useOnboardingChecklist } from './use-onboarding-checklist'

const mockFetch = vi.fn()
global.fetch = mockFetch

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    )
  }
}

describe('useOnboardingChecklist', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ providers: [], activeProvider: null }),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is not ready before the first client read, then settles with a fresh install', async () => {
    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.items).toHaveLength(5)
    // Fresh install: no active provider, nothing skipped/completed — every
    // item that isn't the (blocked) verify step counts as outstanding.
    expect(result.current.outstanding).toBe(4)
  })

  it('re-reads when the onboarding-complete event fires', async () => {
    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(
      result.current.items.find((item) => item.id === 'plugins')?.state,
    ).toBe('todo')

    window.localStorage.setItem(
      ONBOARDING_KEYS.outcome,
      JSON.stringify({
        kind: 'complete',
        at: Date.now(),
        branch: 'quick',
        skipped: ['theme', 'plugins', 'system-check'],
      }),
    )
    window.dispatchEvent(new Event(ONBOARDING_COMPLETE_EVENT))

    // 'plugins' flips from 'todo' to 'skipped' — outstandingCount treats
    // both as outstanding, so asserting on item state (rather than the raw
    // count) is what actually proves the event triggered a re-read.
    await waitFor(() =>
      expect(
        result.current.items.find((item) => item.id === 'plugins')?.state,
      ).toBe('skipped'),
    )
  })

  it('re-reads on a cross-tab storage event for a watched key', async () => {
    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    window.localStorage.setItem(
      ONBOARDING_KEYS.outcome,
      JSON.stringify({
        kind: 'complete',
        at: Date.now(),
        branch: 'quick',
        skipped: [],
        completed: ['theme'],
      }),
    )
    window.dispatchEvent(
      new StorageEvent('storage', { key: ONBOARDING_KEYS.outcome }),
    )

    // 'theme' flips from 'todo' to 'done' off the completion record alone —
    // both the proof that the storage event triggered a re-read, and the proof
    // that a finished step stays finished once the draft has been cleared.
    await waitFor(() =>
      expect(
        result.current.items.find((item) => item.id === 'theme')?.state,
      ).toBe('done'),
    )
  })

  it('clears the badge entirely after a completed full run', async () => {
    // The regression this pins: `verified` and `pluginsTouched` are hardcoded
    // false out here (they are live in-wizard probes), the draft is deleted on
    // finish, and `writeOnboardingComplete` used to persist only `skipped`. A
    // user who completed the full branch — verified, reviewed plugins, picked
    // a theme — was left with a permanent `4` on the sidebar nav and
    // "Setup Wizard (4 left)" in the command palette, with no way to clear it.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ providers: [], activeProvider: 'anthropic' }),
    })
    window.localStorage.setItem(
      ONBOARDING_KEYS.outcome,
      JSON.stringify({
        kind: 'complete',
        at: Date.now(),
        branch: 'full',
        skipped: [],
        completed: ['verify', 'plugins', 'theme', 'system-check'],
      }),
    )

    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.outstanding).toBe(0))
    expect(result.current.items.every((item) => item.state === 'done')).toBe(
      true,
    )
  })

  it('ignores storage events for unrelated keys', async () => {
    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    const before = result.current.items

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'some-unrelated-key' }),
    )

    // Give any (wrongly-triggered) re-read a tick to land, then assert the
    // snapshot reference is unchanged.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.current.items).toBe(before)
  })
})
