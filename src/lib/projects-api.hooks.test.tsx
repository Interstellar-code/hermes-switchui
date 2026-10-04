// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  projectsKeys,
  useBindSessionProject,
  useBulkMoveSessions,
  useUnbindSessionProject,
} from './projects-api'
import type { SessionProjectMap } from './projects-types'

const project = (id: string) => ({
  id,
  slug: id,
  name: id,
  icon: null,
  color: null,
  archived: false,
  board_slug: null,
})

function setup(map: SessionProjectMap) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(projectsKeys.sessionMap('work'), map)
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, fetchMock, wrapper }
}

afterEach(() => vi.unstubAllGlobals())

const MAP: SessionProjectMap = {
  version: 'v',
  projects: [project('pa'), project('pb')],
  sessions: { root: 'pa', tip: 'pa' },
  binding_owner: { tip: 'root' },
  counts: { pa: 1, pb: 0 },
  listable_total: 3,
  unfiled: 2,
}

describe('session project mutations', () => {
  it('unbinding a compressed continuation removes its owner binding', async () => {
    const { client, fetchMock, wrapper } = setup(MAP)
    const { result } = renderHook(() => useUnbindSessionProject('work'), {
      wrapper,
    })
    result.current.mutate('tip')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/hermes-projects/session?sessionKey=root&profile=work',
    )
    const patched = client.getQueryData<SessionProjectMap>(
      projectsKeys.sessionMap('work'),
    )!
    expect(patched.sessions).toEqual({})
    expect(patched.counts).toEqual({ pa: 0, pb: 0 })
    expect(patched.unfiled).toBe(3)
  })

  it('binding moves the optimistic folder counts', async () => {
    const { client, wrapper } = setup(MAP)
    const { result } = renderHook(() => useBindSessionProject('work'), {
      wrapper,
    })
    result.current.mutate({ sessionKey: 'tip', projectSlug: 'pb' })
    await waitFor(() =>
      expect(
        client.getQueryData<SessionProjectMap>(projectsKeys.sessionMap('work'))!
          .counts,
      ).toEqual({ pa: 0, pb: 1 }),
    )
  })

  it('bulk remove skips inherited keys and DELETEs a shared owner once', async () => {
    const { fetchMock, wrapper } = setup({
      ...MAP,
      sessions: { root: 'pa', t1: 'pa', t2: 'pa', inh: 'pa' },
      binding_owner: { t1: 'root', t2: 'root', inh: 'anc' },
      inherited: { inh: true },
    })
    const { result } = renderHook(() => useBulkMoveSessions('work'), {
      wrapper,
    })
    const out = await result.current.mutateAsync({
      sessionKeys: ['t1', 't2', 'inh'],
      projectSlug: null,
    })
    expect(out).toEqual({ failed: [], inherited: ['inh'] })
    const deletes = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'DELETE')
      .map(([url]) => url)
    expect(deletes).toEqual([
      '/api/hermes-projects/session?sessionKey=root&profile=work',
    ])
  })

  it('single unbind of an inherited chat never targets its owner', async () => {
    const { client, fetchMock, wrapper } = setup({
      ...MAP,
      sessions: { anc: 'pa', inh: 'pa' },
      binding_owner: { inh: 'anc' },
      inherited: { inh: true },
    })
    const { result } = renderHook(() => useUnbindSessionProject('work'), {
      wrapper,
    })
    result.current.mutate('inh')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/hermes-projects/session?sessionKey=inh&profile=work',
    )
    expect(
      client.getQueryData<SessionProjectMap>(projectsKeys.sessionMap('work'))!
        .sessions.anc,
    ).toBe('pa')
  })
})
