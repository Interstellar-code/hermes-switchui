// @vitest-environment jsdom
/**
 * Bulk / single delete must drop the rows from EVERY session list the sidebar
 * can render — including the scoped profile feed `useSessionsFeed` switches
 * to whenever a profile is resolved (`?profile=` or the device picker).
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionsFeed } from '../sessions-feed'
import { useBulkDeleteSessions, useDeleteSession } from './use-delete-session'
import type { ReactNode } from 'react'
import { setSessionProfile } from '@/lib/session-scope'
import { useSessionReasoningStore } from '@/stores/session-reasoning-store'

let rows: Array<{ key: string; friendlyId: string; updatedAt: number }> = []
// Tombstones are module state with an 8s TTL — fresh keys per test.
let run = 0
const k = (s: string) => `${s}${run}`
const id = (s: string) => `chat:${k(s)}`

function json(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

beforeEach(() => {
  run += 1
  useSessionReasoningStore.setState({ overrides: {} })
  rows = [k('a'), k('b'), k('c')].map((key, i) => ({
    key,
    friendlyId: key,
    updatedAt: 1000 - i,
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'https://x.test')
      if (url.pathname === '/api/sessions' && init?.method === 'DELETE') {
        const key = url.searchParams.get('sessionKey')
        rows = rows.filter((r) => r.key !== key)
        return json({ ok: true, sessionKey: key })
      }
      if (url.pathname === '/api/sessions') {
        // Two-window fetch: only the non-cron window carries chat rows.
        return json({
          sessions: url.searchParams.get('source') === 'cron' ? [] : rows,
        })
      }
      return json({})
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setSessionProfile(null)
})

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  return renderHook(
    () => ({
      feed: useSessionsFeed({ raw: true }),
      bulk: useBulkDeleteSessions(),
      single: useDeleteSession(),
    }),
    { wrapper },
  )
}

const ids = (r: ReturnType<typeof setup>['result']) =>
  r.current.feed.items.map((i) => i.id).sort()

describe.each([
  ['unscoped', null],
  ['scoped profile', 'hermes-switch'],
])('delete updates the sidebar feed (%s)', (_label, profile) => {
  beforeEach(() => {
    setSessionProfile(profile)
  })

  it('bulk delete removes rows immediately and after refetch', async () => {
    const { result } = setup()
    await waitFor(() =>
      expect(ids(result)).toEqual([id('a'), id('b'), id('c')]),
    )

    await act(async () => {
      await result.current.bulk.deleteSessions([k('a'), k('b')])
    })
    expect(ids(result)).toEqual([id('c')])
    // Still gone once the invalidation refetch settles.
    await waitFor(() => expect(ids(result)).toEqual([id('c')]))
  })

  it('single delete removes the row', async () => {
    const { result } = setup()
    await waitFor(() => expect(ids(result)).toHaveLength(3))

    await act(async () => {
      await result.current.single.deleteSession(k('b'), k('b'), false)
    })
    expect(ids(result)).toEqual([id('a'), id('c')])
  })
})

/**
 * A deleted chat's per-session reasoning override is dead weight in
 * `switchui:session-reasoning`; both delete paths must drop it or the
 * persisted map grows one key per deleted chat forever.
 */
describe('delete clears the per-session reasoning override', () => {
  const overrides = () => useSessionReasoningStore.getState().overrides

  it('single delete clears the key it was scoped to', async () => {
    const { result } = setup()
    useSessionReasoningStore.setState({ overrides: { [k('b')]: true } })

    await act(async () => {
      await result.current.single.deleteSession(k('b'), k('b'), false)
    })

    expect(overrides()).toEqual({})
  })

  it('single delete clears both the session key and a differing friendlyId', async () => {
    const { result } = setup()
    useSessionReasoningStore.setState({
      overrides: { [k('b')]: true, [`${k('b')}-friendly`]: false },
    })

    await act(async () => {
      await result.current.single.deleteSession(
        k('b'),
        `${k('b')}-friendly`,
        false,
      )
    })

    expect(overrides()).toEqual({})
  })

  it("leaves other sessions' overrides alone", async () => {
    const { result } = setup()
    useSessionReasoningStore.setState({
      overrides: { [k('b')]: true, [k('a')]: false },
    })

    await act(async () => {
      await result.current.single.deleteSession(k('b'), k('b'), false)
    })

    expect(overrides()).toEqual({ [k('a')]: false })
  })

  it('bulk delete clears the override of every deleted session', async () => {
    const { result } = setup()
    useSessionReasoningStore.setState({
      overrides: { [k('a')]: true, [k('b')]: false, [k('c')]: true },
    })

    await act(async () => {
      await result.current.bulk.deleteSessions([k('a'), k('b')])
    })

    expect(overrides()).toEqual({ [k('c')]: true })
  })

  it('keeps the override when the delete request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 500 }))),
    )
    const { result } = setup()
    useSessionReasoningStore.setState({ overrides: { [k('b')]: true } })

    await act(async () => {
      await result.current.single
        .deleteSession(k('b'), k('b'), false)
        .catch(() => undefined)
    })

    expect(overrides()).toEqual({ [k('b')]: true })
  })
})
