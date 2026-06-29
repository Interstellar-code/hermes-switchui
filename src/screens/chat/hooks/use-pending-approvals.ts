import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import type { ApprovalRequest } from '@/screens/gateway/lib/approvals-store'
import {
  addApproval,
  loadApprovals,
  saveApprovals,
} from '@/screens/gateway/lib/approvals-store'
import { samePending } from '../chat-screen-utils'

/**
 * C4 — Pending-approvals cluster extracted from ChatScreen.
 *
 * Owns the full lifecycle of tool-call approval requests:
 *   - State: `pendingApprovals` array backed by localStorage via approvals-store.
 *   - E27: ref-sync effect that keeps `pendingApprovalsRef` in step with state.
 *   - E28: self-rescheduling backoff poller (fallback for approvals that arrive
 *          outside the active SSE stream). Cadence: 2s while active, 20s idle.
 *          Reads `waitingForResponseRef` and `activeRealtimeStreamingRef`
 *          non-reactively via `.current` so the deps array stays `[]`.
 *   - `resolvePendingApproval`: writes status/resolvedAt, POSTs to the gateway
 *          approve/deny endpoint, resolves locally even when the fetch rejects.
 *   - `applyApprovalRequest`: moved body of the `onApprovalRequest` callback
 *          that was previously inline in `useRealtimeChatHistory(...)`. Dedupes
 *          by `gatewayApprovalId`, calls `addApproval`, refreshes state.
 *          The parent wires this as `onApprovalRequest: applyApprovalRequest`.
 */
export function usePendingApprovals(params: {
  /** Read non-reactively inside E28 to choose poll cadence. */
  waitingForResponseRef: RefObject<boolean>
  /** Read non-reactively inside E28 to choose poll cadence. */
  activeRealtimeStreamingRef: RefObject<boolean>
}): {
  pendingApprovals: Array<ApprovalRequest>
  resolvePendingApproval: (
    approval: ApprovalRequest,
    status: 'approved' | 'denied',
  ) => Promise<void>
  applyApprovalRequest: (payload: Record<string, unknown>) => void
} {
  const { waitingForResponseRef, activeRealtimeStreamingRef } = params

  const [pendingApprovals, setPendingApprovals] = useState<
    Array<ApprovalRequest>
  >([])

  // E27: keep ref in sync with state so E28's closure always sees the latest
  // list without taking pendingApprovals as a dep (which would restart the timer).
  const pendingApprovalsRef = useRef(pendingApprovals)
  useEffect(() => {
    pendingApprovalsRef.current = pendingApprovals
  }, [pendingApprovals])

  // E28: backoff poller — fallback for approvals that arrive outside the active
  // SSE stream (Issue #214). Heavy idle back-off (20 s) avoids a pointless
  // setState on every tick for the component's whole lifetime. samePending
  // short-circuits setState when nothing changed so idle state is re-render free.
  useEffect(() => {
    let timer: number | null = null
    const checkApprovals = () => {
      const next = loadApprovals().filter((entry) => entry.status === 'pending')
      if (!samePending(next, pendingApprovalsRef.current)) {
        setPendingApprovals(next)
      }
      // Poll fast (2s) only while a run is active or approvals are pending;
      // otherwise back off to 20s. SSE handles the prompt-during-run case.
      const active =
        waitingForResponseRef.current ||
        activeRealtimeStreamingRef.current ||
        next.length > 0
      timer = window.setTimeout(checkApprovals, active ? 2000 : 20000)
    }
    checkApprovals()
    return () => {
      if (timer !== null) window.clearTimeout(timer)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-only; refs read non-reactively

  const resolvePendingApproval = useCallback(
    async (approval: ApprovalRequest, status: 'approved' | 'denied') => {
      const nextApprovals = loadApprovals().map((entry) => {
        if (entry.id !== approval.id) return entry
        return {
          ...entry,
          status,
          resolvedAt: Date.now(),
        }
      })
      saveApprovals(nextApprovals)
      setPendingApprovals(
        nextApprovals.filter((entry) => entry.status === 'pending'),
      )
      if (!approval.gatewayApprovalId) return

      const endpoint =
        status === 'approved'
          ? `/api/approvals/${approval.gatewayApprovalId}/approve`
          : `/api/approvals/${approval.gatewayApprovalId}/deny`
      try {
        await fetch(endpoint, { method: 'POST' })
      } catch {
        // Local resolution still succeeds when API endpoint is unavailable.
      }
    },
    [],
  )

  // Moved body of onApprovalRequest from useRealtimeChatHistory inline callback.
  // Dedupes by gatewayApprovalId (idempotent for same approval arriving twice).
  const applyApprovalRequest = useCallback(
    (payload: Record<string, unknown>) => {
      const approvalId =
        typeof payload.id === 'string'
          ? payload.id
          : typeof payload.approvalId === 'string'
            ? payload.approvalId
            : typeof payload.approvalId === 'string'
              ? payload.approvalId
              : ''

      const currentApprovals = loadApprovals()
      if (
        approvalId &&
        currentApprovals.some((entry) => {
          return (
            entry.status === 'pending' && entry.gatewayApprovalId === approvalId
          )
        })
      ) {
        setPendingApprovals(
          currentApprovals.filter((entry) => entry.status === 'pending'),
        )
        return
      }

      const actionValue = payload.action ?? payload.tool ?? payload.command
      const action =
        typeof actionValue === 'string'
          ? actionValue
          : actionValue
            ? JSON.stringify(actionValue)
            : 'Tool call requires approval'
      const contextValue = payload.context ?? payload.input ?? payload.args
      const context =
        typeof contextValue === 'string'
          ? contextValue
          : contextValue
            ? JSON.stringify(contextValue)
            : ''
      const agentNameValue =
        payload.agentName ?? payload.agent ?? payload.source
      const agentName =
        typeof agentNameValue === 'string' && agentNameValue.trim().length > 0
          ? agentNameValue
          : 'Agent'
      const agentIdValue =
        payload.agentId ?? payload.sessionKey ?? payload.source
      const agentId =
        typeof agentIdValue === 'string' && agentIdValue.trim().length > 0
          ? agentIdValue
          : 'claude'

      addApproval({
        agentId,
        agentName,
        action,
        context,
        source: 'agent',
        gatewayApprovalId: approvalId || undefined,
      })
      setPendingApprovals(
        loadApprovals().filter((entry) => entry.status === 'pending'),
      )
    },
    [],
  )

  return { pendingApprovals, resolvePendingApproval, applyApprovalRequest }
}
