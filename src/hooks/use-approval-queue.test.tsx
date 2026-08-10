// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchPendingApprovals,
  parsePendingApproval,
  usePendingApprovalQueue,
} from './use-approval-queue'
import type { ReactNode } from 'react'
import { useChatStore } from '@/stores/chat-store'

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

beforeEach(() => {
  useChatStore.setState({ pendingClarify: {} })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useChatStore.setState({ pendingClarify: {} })
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
  it('returns an empty list rather than throwing on failure', async () => {
    stubList({}, false, 500)
    expect(await fetchPendingApprovals(null)).toEqual({
      approvals: [],
      unsupported: false,
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
})
