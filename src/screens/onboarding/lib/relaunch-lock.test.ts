// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useCorePlugins } from '../hooks/use-core-plugins'
import { useConnectStatus } from '../hooks/use-connect-status'
import { canWriteConfig } from './relaunch-lock'
import { ONBOARDING_STEPS } from './onboarding-steps'
import type { OnboardingStepId } from './onboarding-steps'
import type { OnboardingMode } from './onboarding-mode'

const ALL_STEP_IDS: Array<OnboardingStepId> = ONBOARDING_STEPS.map(
  (step) => step.id,
)
const ALL_MODES: Array<OnboardingMode> = ['first-run', 'resume', 'relaunch']

describe('canWriteConfig — full matrix', () => {
  for (const mode of ALL_MODES) {
    for (const stepId of ALL_STEP_IDS) {
      for (const unlocked of [true, false]) {
        const expected =
          mode === 'relaunch' ? stepId !== 'summary' && unlocked : true

        it(`mode=${mode} stepId=${stepId} unlocked=${unlocked} → ${expected}`, () => {
          expect(canWriteConfig({ mode, unlocked, stepId })).toBe(expected)
        })
      }
    }
  }
})

describe('canWriteConfig — contract summary', () => {
  it('first-run always allows writes, on every step', () => {
    for (const stepId of ALL_STEP_IDS) {
      expect(
        canWriteConfig({ mode: 'first-run', unlocked: false, stepId }),
      ).toBe(true)
      expect(
        canWriteConfig({ mode: 'first-run', unlocked: true, stepId }),
      ).toBe(true)
    }
  })

  it('resume always allows writes, on every step', () => {
    for (const stepId of ALL_STEP_IDS) {
      expect(canWriteConfig({ mode: 'resume', unlocked: false, stepId })).toBe(
        true,
      )
      expect(canWriteConfig({ mode: 'resume', unlocked: true, stepId })).toBe(
        true,
      )
    }
  })

  it('relaunch blocks the summary step even when unlocked', () => {
    expect(
      canWriteConfig({ mode: 'relaunch', unlocked: true, stepId: 'summary' }),
    ).toBe(false)
  })

  it('relaunch blocks every other step unless unlocked', () => {
    for (const stepId of ALL_STEP_IDS.filter((id) => id !== 'summary')) {
      expect(
        canWriteConfig({ mode: 'relaunch', unlocked: false, stepId }),
      ).toBe(false)
      expect(canWriteConfig({ mode: 'relaunch', unlocked: true, stepId })).toBe(
        true,
      )
    }
  })
})

// ── the other mutations the lock has to cover ──────────────────────────────
// The config PATCH is not the only thing this wizard can do to a user's
// system. A locked relaunch reaches the plugins and system-check steps
// through the summary's checklist links, and those steps enable/disable agent
// plugins, POST /api/start-agent, POST /api/gateway-reprobe and restart the
// gateway. "Nothing written to config.yaml" was true; "your existing setup is
// read-only here", which is what the screen says, was not.

const enableAgentPlugin = vi.fn((_name: string) => Promise.resolve({}))
const disableAgentPlugin = vi.fn((_name: string) => Promise.resolve({}))
const restartMutate = vi.fn(() => Promise.resolve({}))

type FetchMock = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

const okResponse = () =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)

vi.mock('@/lib/hermes-client', () => ({
  enableAgentPlugin: (name: string) => enableAgentPlugin(name),
  disableAgentPlugin: (name: string) => disableAgentPlugin(name),
  getPluginsHub: () => Promise.resolve({ plugins: [] }),
}))

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

describe('the lock covers every mutation the wizard can perform', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    enableAgentPlugin.mockClear()
    disableAgentPlugin.mockClear()
    restartMutate.mockClear()
  })

  it('useCorePlugins.toggle performs no enable/disable while locked', async () => {
    const { result } = renderHook(
      () => useCorePlugins({ enabled: true, canWrite: false }),
      { wrapper },
    )

    await act(async () => {
      await result.current.toggle('hermes-kanban', 'enable')
      await result.current.toggle('hermes-kanban', 'disable')
    })

    expect(enableAgentPlugin).not.toHaveBeenCalled()
    expect(disableAgentPlugin).not.toHaveBeenCalled()
    expect(result.current.touched).toBe(false)
    // And the control is not even offered.
    expect(result.current.canRestart).toBe(false)
  })

  it('useCorePlugins.toggle works again once unlocked', async () => {
    const { result } = renderHook(
      () => useCorePlugins({ enabled: true, canWrite: true }),
      { wrapper },
    )

    await act(async () => {
      await result.current.toggle('hermes-kanban', 'enable')
    })

    expect(enableAgentPlugin).toHaveBeenCalledWith('hermes-kanban')
  })

  it('useCorePlugins.restart does not bounce the dashboard while locked', async () => {
    const { result } = renderHook(
      () => useCorePlugins({ enabled: true, canWrite: false }),
      { wrapper },
    )

    await act(async () => {
      await result.current.restart()
    })

    expect(restartMutate).not.toHaveBeenCalled()
  })

  it('useConnectStatus.heal issues no self-heal request while locked', async () => {
    const fetchMock = vi.fn<FetchMock>(okResponse)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(
      () =>
        useConnectStatus({
          enabled: true,
          canWrite: false,
          activeProvider: null,
        }),
      { wrapper },
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fetchMock.mockClear()

    await act(async () => {
      await result.current.heal('start-agent')
      await result.current.heal('reprobe')
      await result.current.heal('restart-gateway')
    })

    const posted = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === 'POST',
    )
    expect(posted).toHaveLength(0)
    expect(restartMutate).not.toHaveBeenCalled()
  })

  it('useConnectStatus.heal runs again once unlocked', async () => {
    const fetchMock = vi.fn<FetchMock>(okResponse)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(
      () =>
        useConnectStatus({
          enabled: true,
          canWrite: true,
          activeProvider: null,
        }),
      { wrapper },
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fetchMock.mockClear()

    await act(async () => {
      await result.current.heal('start-agent')
    })

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === '/api/start-agent' && init?.method === 'POST',
      ),
    ).toBe(true)
  })
})
