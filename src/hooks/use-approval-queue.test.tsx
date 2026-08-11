// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  approvalPollInterval,
  clearApprovalSubmitting,
  fetchPendingApprovals,
  markApprovalSubmitting,
  parsePendingApproval,
  usePendingApprovalQueue,
} from './use-approval-queue'
import type { ReactNode } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { setSessionProfile } from '@/lib/session-scope'

/**
 * Catch-up (contract v1 §3). An approval is emitted once and never re-sent, so
 * a reload mid-approval leaves the agent blocked against a card nobody can
 * see. `GET /api/approvals/pending` is the only recovery path.
 */

const ROW = {
  approval_id: 'approval_ab12cd34ef',
  run_id: 'run_1111',
  session_id: 'sess-a',
  choices: ['once', 'session', 'always', 'deny'],
  command: 'rm -rf /tmp/demo',
  description: 'delete temp dir',
  pattern_keys: ['shell-c'],
  allow_permanent: true,
  expires_at: '2126-08-10T09:31:00Z',
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function stubList(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, status, json: async () => body }),
  )
}

/**
 * `waitFor(() => expect(fetch).toHaveBeenCalled())` can resolve on the very
 * first render tick, before the mocked fetch's own promise chain (and the
 * query's resulting effects) have actually settled — a negative assertion
 * right after it would then pass for the wrong reason. This flushes a real
 * macrotask so any already-queued microtasks (including the reconciliation
 * effect) have had a turn.
 */
async function flushSettled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** A live, unresolved approval card shaped like the store holds it. */
function approvalCard(over: Record<string, unknown> = {}) {
  return {
    clarifyId: 'approval_ab12cd34ef',
    kind: 'approval' as const,
    toolName: 'approval',
    question: 'delete temp dir',
    choices: ['once', 'session', 'always', 'deny'],
    approval: { runId: 'run_1111' },
    runId: 'run_1111',
    requestedAt: Date.now(),
    ...over,
  }
}

beforeEach(() => {
  useChatStore.setState({ pendingClarify: {} })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useChatStore.setState({ pendingClarify: {} })
  setSessionProfile(null)
})

describe('parsePendingApproval', () => {
  it('maps a contract §1 row onto the card shape', () => {
    expect(parsePendingApproval(ROW)).toEqual({
      clarifyId: 'approval_ab12cd34ef',
      sessionId: 'sess-a',
      choices: ['once', 'session', 'always', 'deny'],
      question: 'delete temp dir',
      approval: {
        runId: 'run_1111',
        command: 'rm -rf /tmp/demo',
        description: 'delete temp dir',
        patternKey: undefined,
        patternKeys: ['shell-c'],
        allowPermanent: true,
        smartDenied: undefined,
        expiresAt: '2126-08-10T09:31:00Z',
      },
    })
  })

  it('drops rows with nothing to resolve or nowhere to show', () => {
    const { run_id: _r, ...noRun } = ROW
    const { session_id: _s, ...noSession } = ROW
    expect(parsePendingApproval(noRun)).toBeNull()
    expect(parsePendingApproval(noSession)).toBeNull()
  })

  it('falls back to the derived choice set when the row omits choices', () => {
    const { choices: _c, ...noChoices } = ROW
    expect(parsePendingApproval({ ...noChoices, smart_denied: true })?.choices).toEqual(
      ['once', 'deny'],
    )
  })
})

describe('fetchPendingApprovals', () => {
  it('returns an empty list rather than throwing on failure, marked ok:false', async () => {
    stubList({}, false, 500)
    expect(await fetchPendingApprovals(null)).toEqual({
      approvals: [],
      unsupported: false,
      ok: false,
    })
  })

  it('marks a real empty answer ok:true — reconciliation must tell the two apart', async () => {
    stubList({ approvals: [] })
    expect(await fetchPendingApprovals(null)).toEqual({
      approvals: [],
      unsupported: false,
      ok: true,
    })
  })

  it('passes the profile through as a query param', async () => {
    stubList({ approvals: [] })
    await fetchPendingApprovals('neo')
    expect(fetch).toHaveBeenCalledWith('/api/approvals/pending?profile=neo')
  })
})

describe('usePendingApprovalQueue', () => {
  it('recovers a pending approval into the chat store on mount', async () => {
    stubList({ ok: true, approvals: [ROW] })
    const { result } = renderHook(() => usePendingApprovalQueue(), { wrapper })

    await waitFor(() => expect(result.current.count).toBe(1))
    await waitFor(() => {
      const card = useChatStore.getState().getPendingClarify('sess-a')
      expect(card?.kind).toBe('approval')
      expect(card?.approval?.runId).toBe('run_1111')
      expect(card?.choices).toEqual(['once', 'session', 'always', 'deny'])
    })
  })

  it('does not resurrect a card the user already decided', async () => {
    stubList({ ok: true, approvals: [ROW] })
    const store = useChatStore.getState()
    store.processEvent({
      type: 'clarify',
      transport: 'send-stream',
      clarifyId: 'approval_ab12cd34ef',
      kind: 'approval',
      question: 'delete temp dir',
      choices: ['once', 'deny'],
      approval: { runId: 'run_1111' },
      sessionKey: 'sess-a',
      runId: 'run_1111',
    })
    store.markClarifyResolved('sess-a', 'approval_ab12cd34ef', 'deny')

    renderHook(() => usePendingApprovalQueue(), { wrapper })
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    const card = useChatStore.getState().getPendingClarify('sess-a')
    expect(card?.resolved).toBe(true)
    expect(card?.answer).toBe('deny')
  })

  it('reports an unsupported gateway without treating it as an error', async () => {
    stubList({ ok: true, approvals: [], unsupported: true })
    const { result } = renderHook(() => usePendingApprovalQueue(), { wrapper })
    await waitFor(() => expect(result.current.unsupported).toBe(true))
    expect(result.current.count).toBe(0)
  })

  it('never calls the resolve endpoint', async () => {
    stubList({ ok: true, approvals: [ROW] })
    const { result } = renderHook(() => usePendingApprovalQueue(), { wrapper })
    await waitFor(() => expect(result.current.count).toBe(1))

    const calls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
    expect(calls.every((url) => url.startsWith('/api/approvals/pending'))).toBe(true)
  })

  it('polls at the idle cadence as a backstop when the tab stays focused and never reconnects', async () => {
    // Fake timers must be in place *before* the observer mounts: react-query
    // schedules its refetch interval with the global `setInterval` at mount
    // time (and again each time the query settles), so faking the clock only
    // after mounting leaves that interval running for real in the
    // background, unreachable by `advanceTimersByTimeAsync`.
    vi.useFakeTimers()
    try {
      stubList({ ok: true, approvals: [] })
      renderHook(() => usePendingApprovalQueue(), { wrapper })

      // Flush the mount-time fetch (a microtask chain, not a timer).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(fetch).toHaveBeenCalledTimes(1)

      // Below the idle cadence: no second poll yet.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(fetch).toHaveBeenCalledTimes(1)

      // Crossing ~15s: the backstop fires.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('tightens to the pending cadence once something is waiting, without going below the gateway timeout', async () => {
    vi.useFakeTimers()
    try {
      stubList({ ok: true, approvals: [ROW] })
      renderHook(() => usePendingApprovalQueue(), { wrapper })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(fetch).toHaveBeenCalledTimes(1)

      // /api/approvals/pending times out its gateway call at 10s
      // (routes/api/approvals.pending.ts) — the tightened cadence must not
      // poll faster than that.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('reconciliation (#17): a card with no removal path must still close', () => {
  it('closes a card whose approval fell out of a successful pending response', async () => {
    useChatStore.setState({ pendingClarify: { 'sess-a': approvalCard() } })
    stubList({ approvals: [] })
    renderHook(() => usePendingApprovalQueue(), { wrapper })

    await waitFor(() => {
      const card = useChatStore.getState().getPendingClarify('sess-a')
      expect(card?.resolved).toBe(true)
      expect(card?.closedNote).toContain('already handled')
    })
  })

  it('closes nothing when the poll itself failed', async () => {
    useChatStore.setState({ pendingClarify: { 'sess-a': approvalCard() } })
    stubList({}, false, 500)
    renderHook(() => usePendingApprovalQueue(), { wrapper })

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await flushSettled()
    const card = useChatStore.getState().getPendingClarify('sess-a')
    expect(card?.resolved).toBeFalsy()
  })

  it('closes nothing when the gateway build has no catch-up endpoint', async () => {
    useChatStore.setState({ pendingClarify: { 'sess-a': approvalCard() } })
    stubList({ approvals: [], unsupported: true })
    renderHook(() => usePendingApprovalQueue(), { wrapper })

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await flushSettled()
    const card = useChatStore.getState().getPendingClarify('sess-a')
    expect(card?.resolved).toBeFalsy()
  })

  it('does not disturb a card the user already resolved locally', async () => {
    useChatStore.setState({
      pendingClarify: {
        'sess-a': approvalCard({ resolved: true, answer: 'once' }),
      },
    })
    stubList({ approvals: [] })
    renderHook(() => usePendingApprovalQueue(), { wrapper })

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await flushSettled()
    const card = useChatStore.getState().getPendingClarify('sess-a')
    expect(card?.answer).toBe('once')
    expect(card?.closedNote).toBeUndefined()
  })

  it('does not close a card whose resolve POST is mid-flight', async () => {
    useChatStore.setState({ pendingClarify: { 'sess-a': approvalCard() } })
    markApprovalSubmitting('run_1111')
    try {
      stubList({ approvals: [] })
      renderHook(() => usePendingApprovalQueue(), { wrapper })

      await waitFor(() => expect(fetch).toHaveBeenCalled())
      await flushSettled()
      const card = useChatStore.getState().getPendingClarify('sess-a')
      expect(card?.resolved).toBeFalsy()
    } finally {
      clearApprovalSubmitting('run_1111')
    }
  })

  it('never closes a card scoped to a profile the current poll did not ask about', async () => {
    // Ambient profile stays unset (null) — this poll covers only the
    // unscoped/default profile. A card filed under a DIFFERENT profile's
    // composite key must be left alone; an empty list from this poll says
    // nothing about that profile's gateway state.
    useChatStore.setState({
      pendingClarify: {
        'other-profile::sess-b': approvalCard({
          approval: { runId: 'run_2222' },
          runId: 'run_2222',
        }),
      },
    })
    stubList({ approvals: [] })
    renderHook(() => usePendingApprovalQueue(), { wrapper })

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await flushSettled()
    const card = useChatStore.getState().pendingClarify['other-profile::sess-b']
    expect(card?.resolved).toBeFalsy()
  })

  it('does not close a card whose run is still in the pending list', async () => {
    useChatStore.setState({ pendingClarify: { 'sess-a': approvalCard() } })
    stubList({ approvals: [ROW] }) // ROW's run_id is 'run_1111', same card
    renderHook(() => usePendingApprovalQueue(), { wrapper })

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await flushSettled()
    const card = useChatStore.getState().getPendingClarify('sess-a')
    expect(card?.resolved).toBeFalsy()
  })
})

describe('approvalPollInterval', () => {
  it('uses the idle cadence when the queue is empty or has not loaded yet', () => {
    expect(approvalPollInterval({ state: {} })).toBe(15_000)
    expect(approvalPollInterval({ state: { data: { approvals: [] } } })).toBe(15_000)
  })

  it('tightens to the pending cadence once approvals are waiting', () => {
    expect(
      approvalPollInterval({ state: { data: { approvals: [ROW] } } }),
    ).toBe(10_000)
  })

  it('never returns an interval below the /api/approvals/pending gateway timeout (10s)', () => {
    expect(approvalPollInterval({ state: {} })).toBeGreaterThanOrEqual(10_000)
    expect(
      approvalPollInterval({ state: { data: { approvals: [ROW] } } }),
    ).toBeGreaterThanOrEqual(10_000)
  })
})
