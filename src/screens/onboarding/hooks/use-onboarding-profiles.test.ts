// @vitest-environment jsdom
/**
 * The write lock has to hold below the UI, not only in it: `ProfilePicker`
 * withholds the button while locked, and this proves the hook refuses too, so
 * a future caller that forgets the gate still cannot switch someone's agent.
 * Plus the two things the happy path owes the rest of the app — the restart
 * store gets marked, and `needsRestart` comes from the response.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useOnboardingProfiles } from './use-onboarding-profiles'
import { useGatewayRestartStore } from '@/stores/gateway-restart-store'

const LIST_BODY = {
  activeProfile: 'default',
  profiles: [
    { name: 'default' },
    { name: 'neo', agent_ui: { tier: 2, glyph: 'NE', role: 'Builder' } },
  ],
}

type FetchMock = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response)
}

function installFetchMock(
  activateBody: unknown = {
    ok: true,
    profile: 'neo',
    needsGatewayRestart: true,
  },
) {
  const fetchMock = vi.fn<FetchMock>((input) => {
    const url = String(input)
    if (url.startsWith('/api/profiles/list')) return jsonResponse(LIST_BODY)
    if (url.startsWith('/api/profiles/activate')) {
      return jsonResponse(activateBody)
    }
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return React.createElement(QueryClientProvider, { client }, children)
}

describe('useOnboardingProfiles', () => {
  beforeEach(() => {
    useGatewayRestartStore.getState().dismiss()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useGatewayRestartStore.getState().dismiss()
  })

  it('issues no request at all while the run is locked', async () => {
    const fetchMock = installFetchMock()
    const { result } = renderHook(
      () => useOnboardingProfiles({ enabled: true, canWrite: false }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.choices.length).toBe(2))
    fetchMock.mockClear()

    await act(async () => {
      await result.current.activate('neo')
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.touched).toBe(false)
    expect(result.current.needsRestart).toBe(false)
    expect(useGatewayRestartStore.getState().needsRestart).toBe(false)
  })

  it('activates, marks the restart store, and reports the restart requirement', async () => {
    const fetchMock = installFetchMock()
    const { result } = renderHook(
      () => useOnboardingProfiles({ enabled: true, canWrite: true }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.activeName).toBe('default'))

    await act(async () => {
      await result.current.activate('neo')
    })

    const posted = fetchMock.mock.calls.find(
      ([input]) => String(input) === '/api/profiles/activate',
    )
    expect(posted).toBeDefined()
    expect(posted?.[1]?.method).toBe('POST')
    // The API's CSRF guard is a Content-Type check.
    expect(posted?.[1]?.headers).toMatchObject({
      'Content-Type': 'application/json',
    })
    expect(posted?.[1]?.body).toBe(JSON.stringify({ name: 'neo' }))

    expect(result.current.touched).toBe(true)
    expect(result.current.needsRestart).toBe(true)
    expect(result.current.activating).toBeNull()
    expect(useGatewayRestartStore.getState()).toMatchObject({
      needsRestart: true,
      profileName: 'neo',
    })
  })

  it('surfaces a failed activation as `error` rather than throwing', async () => {
    installFetchMock()
    const fetchMock = vi.fn<FetchMock>((input) => {
      const url = String(input)
      if (url.startsWith('/api/profiles/list')) return jsonResponse(LIST_BODY)
      return jsonResponse({ error: 'Profile not found' }, false)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(
      () => useOnboardingProfiles({ enabled: true, canWrite: true }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.activeName).toBe('default'))

    await act(async () => {
      await expect(result.current.activate('ghost')).resolves.toBeUndefined()
    })

    expect(result.current.error).toBe('Profile not found')
    expect(result.current.touched).toBe(false)
    expect(useGatewayRestartStore.getState().needsRestart).toBe(false)
  })

  it('reports a failed list read without losing the step', async () => {
    const fetchMock = vi.fn<FetchMock>(() => jsonResponse({}, false))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(
      () => useOnboardingProfiles({ enabled: true, canWrite: true }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.choices).toEqual([])
    expect(result.current.activeName).toBeNull()
  })

  it('fetches nothing until the step is enabled', async () => {
    const fetchMock = installFetchMock()
    renderHook(
      () => useOnboardingProfiles({ enabled: false, canWrite: true }),
      {
        wrapper,
      },
    )
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
