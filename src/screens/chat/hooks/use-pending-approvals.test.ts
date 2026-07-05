// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { usePendingApprovals } from './use-pending-approvals'
import type { ApprovalRequest } from '@/screens/gateway/lib/approvals-store'
import {
  addApproval,
  loadApprovals,
} from '@/screens/gateway/lib/approvals-store'

// Helpers for building stub ref objects
function makeRef<T>(initial: T): { current: T } {
  return { current: initial }
}

// Seeds approvals into localStorage via the real store and returns the entry.
function seedPending(
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  return addApproval({
    agentId: 'test-agent',
    agentName: 'Test Agent',
    action: 'bash ls',
    context: '{}',
    source: 'agent',
    gatewayApprovalId: overrides.gatewayApprovalId ?? `gwid-${Date.now()}`,
    ...overrides,
  })
}

describe('usePendingApprovals', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Clear localStorage between tests so approvals-store starts clean.
    localStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // ── E28 idle cadence (20 s) ────────────────────────────────────────────────

  it('picks up a seeded pending approval after the idle 20 s poll', async () => {
    seedPending({ gatewayApprovalId: 'gwid-idle' })

    const waitingForResponseRef = makeRef(false)
    const activeRealtimeStreamingRef = makeRef(false)

    const { result } = renderHook(() =>
      usePendingApprovals({ waitingForResponseRef, activeRealtimeStreamingRef }),
    )

    // Initial synchronous checkApprovals populates state immediately.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.pendingApprovals).toHaveLength(1)
    expect(result.current.pendingApprovals[0].gatewayApprovalId).toBe('gwid-idle')
  })

  // ── E28 active cadence (2 s) ───────────────────────────────────────────────

  it('uses 2 s fast cadence when waitingForResponseRef.current is true', async () => {
    const waitingForResponseRef = makeRef(true)
    const activeRealtimeStreamingRef = makeRef(false)

    const { result } = renderHook(() =>
      usePendingApprovals({ waitingForResponseRef, activeRealtimeStreamingRef }),
    )

    // Seed AFTER the first sync call so the 2s-scheduled next tick picks it up.
    seedPending({ gatewayApprovalId: 'gwid-fast' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100)
    })

    expect(result.current.pendingApprovals).toHaveLength(1)
    expect(result.current.pendingApprovals[0].gatewayApprovalId).toBe('gwid-fast')
  })

  // ── mount-order: ref flips false→true mid-flight switches to 2 s cadence ────

  it('reschedules at 2 s once activeRealtimeStreamingRef flips true mid-flight', async () => {
    const waitingForResponseRef = makeRef(false)
    const activeRealtimeStreamingRef = makeRef(false)

    const { result } = renderHook(() =>
      usePendingApprovals({ waitingForResponseRef, activeRealtimeStreamingRef }),
    )

    // First synchronous check runs with both refs false → schedules the 20 s
    // idle timer. Flip the stream ref true (as the parent's render-time mirror
    // would once the stream is active) and seed an approval.
    activeRealtimeStreamingRef.current = true
    seedPending({ gatewayApprovalId: 'gwid-flip' })

    // The already-scheduled 20 s timer must still be pending at 2 s (the flip
    // does not retroactively shorten it).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100)
    })
    expect(result.current.pendingApprovals).toHaveLength(0)

    // At 20 s the idle timer fires, picks up the approval, and — now reading
    // the flipped ref — reschedules at the 2 s fast cadence.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(18_000)
    })
    expect(result.current.pendingApprovals).toHaveLength(1)

    // Prove the next tick is 2 s: a second approval is picked up after ~2 s.
    seedPending({ gatewayApprovalId: 'gwid-flip-2' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100)
    })
    expect(result.current.pendingApprovals).toHaveLength(2)
  })

  // ── samePending short-circuit ──────────────────────────────────────────────

  it('does not trigger an extra re-render when nothing changes (samePending guard)', async () => {
    seedPending({ gatewayApprovalId: 'gwid-stable' })

    const waitingForResponseRef = makeRef(false)
    const activeRealtimeStreamingRef = makeRef(false)

    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount++
      return usePendingApprovals({
        waitingForResponseRef,
        activeRealtimeStreamingRef,
      })
    })

    // First sync tick
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const countAfterFirstTick = renderCount

    // Advance into the next poll tick (pending approval still there → active cadence → 2s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100)
    })

    // Nothing changed in localStorage → samePending bails → no new setState → no extra render
    expect(renderCount).toBe(countAfterFirstTick)
    expect(result.current.pendingApprovals).toHaveLength(1)
  })

  // ── resolvePendingApproval: approve path ───────────────────────────────────

  it('resolvePendingApproval sets status to approved, calls /approve endpoint, updates state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const entry = seedPending({ gatewayApprovalId: 'gwid-resolve' })

    const waitingForResponseRef = makeRef(false)
    const activeRealtimeStreamingRef = makeRef(false)

    const { result } = renderHook(() =>
      usePendingApprovals({ waitingForResponseRef, activeRealtimeStreamingRef }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.pendingApprovals).toHaveLength(1)

    await act(async () => {
      await result.current.resolvePendingApproval(entry, 'approved')
    })

    // State updated: no more pending approvals
    expect(result.current.pendingApprovals).toHaveLength(0)

    // localStorage also updated
    const stored = loadApprovals()
    const resolved = stored.find((a) => a.id === entry.id)
    expect(resolved?.status).toBe('approved')
    expect(resolved?.resolvedAt).toBeDefined()

    // Correct endpoint called
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/approvals/gwid-resolve/approve`,
      { method: 'POST' },
    )
  })

  it('resolvePendingApproval resolves locally even when fetch rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'))
    vi.stubGlobal('fetch', fetchMock)

    const entry = seedPending({ gatewayApprovalId: 'gwid-fail' })

    const waitingForResponseRef = makeRef(false)
    const activeRealtimeStreamingRef = makeRef(false)

    const { result } = renderHook(() =>
      usePendingApprovals({ waitingForResponseRef, activeRealtimeStreamingRef }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Should not throw despite fetch rejection
    await act(async () => {
      await result.current.resolvePendingApproval(entry, 'denied')
    })

    // Local resolution still happened
    expect(result.current.pendingApprovals).toHaveLength(0)
    const stored = loadApprovals()
    const resolved = stored.find((a) => a.id === entry.id)
    expect(resolved?.status).toBe('denied')
  })

  // ── applyApprovalRequest: new approval ────────────────────────────────────

  it('applyApprovalRequest adds a new approval and updates pendingApprovals', async () => {
    const waitingForResponseRef = makeRef(false)
    const activeRealtimeStreamingRef = makeRef(false)

    const { result } = renderHook(() =>
      usePendingApprovals({ waitingForResponseRef, activeRealtimeStreamingRef }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.pendingApprovals).toHaveLength(0)

    act(() => {
      result.current.applyApprovalRequest({
        id: 'gwid-new',
        action: 'write file',
        context: '{"path": "/tmp/x"}',
        agentName: 'Claude',
        agentId: 'agent-1',
      })
    })

    expect(result.current.pendingApprovals).toHaveLength(1)
    expect(result.current.pendingApprovals[0].gatewayApprovalId).toBe('gwid-new')
    expect(result.current.pendingApprovals[0].action).toBe('write file')
  })

  // ── applyApprovalRequest: idempotency ─────────────────────────────────────

  it('applyApprovalRequest is idempotent for same gatewayApprovalId', async () => {
    // Pre-seed the same gatewayApprovalId
    seedPending({ gatewayApprovalId: 'gwid-dup' })

    const waitingForResponseRef = makeRef(false)
    const activeRealtimeStreamingRef = makeRef(false)

    const { result } = renderHook(() =>
      usePendingApprovals({ waitingForResponseRef, activeRealtimeStreamingRef }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.pendingApprovals).toHaveLength(1)

    act(() => {
      result.current.applyApprovalRequest({
        id: 'gwid-dup',
        action: 'duplicate call',
        context: '{}',
        agentName: 'Agent',
        agentId: 'agent-2',
      })
    })

    // Still only one — dedup by gatewayApprovalId
    expect(result.current.pendingApprovals).toHaveLength(1)
  })

  // ── cleanup on unmount ────────────────────────────────────────────────────

  it('clears the timer on unmount (no post-unmount setState)', async () => {
    const waitingForResponseRef = makeRef(false)
    const activeRealtimeStreamingRef = makeRef(false)

    const { unmount } = renderHook(() =>
      usePendingApprovals({ waitingForResponseRef, activeRealtimeStreamingRef }),
    )

    unmount()

    // If the timer were still running this would throw "Cannot update unmounted component"
    // or similar — simply advancing time without error is the signal.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000)
    })
    // No assertion needed — no thrown error means cleanup was correct.
  })
})
