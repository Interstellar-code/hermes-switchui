/**
 * Cross-session view of blocking command approvals, plus catch-up.
 *
 * An approval is emitted on the chat stream exactly once and is never
 * re-sent — not on reconnect, not in any status payload. A refresh mid-approval
 * would otherwise leave the agent blocked against a card nobody can see, until
 * it silently auto-denied. `GET /api/approvals/pending` is the recovery path;
 * this hook is the only caller.
 *
 * It does two things and no more:
 *   1. Seeds recovered approvals back into the chat store, so the card
 *      re-renders in the chat it belongs to.
 *   2. Exposes the list so the bell can show a count and point at it.
 *
 * It deliberately does NOT resolve anything. A decision made from a list, away
 * from the command and its context, is exactly the approval-by-reflex this
 * feature exists to prevent — and a second resolve surface would race the card
 * for a queue the gateway pops FIFO.
 */
import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PendingApprovalDetail } from '@/lib/approvals'
import { useChatStore } from '@/stores/chat-store'
import { activeScopeKey, getSessionProfile } from '@/lib/session-scope'
import {
  approvalQuestion,
  fallbackApprovalChoices,
  parseApprovalDetail,
} from '@/lib/approvals'

export type PendingApprovalEntry = {
  /** Identity for the card; falls back to the run id when absent. */
  clarifyId: string
  /** Raw gateway session id — the chat this approval blocks. */
  sessionId: string
  choices: Array<string>
  question: string
  approval: PendingApprovalDetail
}

export type PendingApprovalQueue = {
  approvals: Array<PendingApprovalEntry>
  count: number
  /** The gateway build has no catch-up endpoint — not an error worth showing. */
  unsupported: boolean
}

const EMPTY: Array<PendingApprovalEntry> = []

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Wire row → the shape the chat store and the bell both consume. */
export function parsePendingApproval(raw: unknown): PendingApprovalEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const approval = parseApprovalDetail(d)
  if (!approval) return null

  const sessionId = readString(d.session_id) || readString(d.sessionId)
  if (!sessionId) return null

  const choices = Array.isArray(d.choices)
    ? d.choices.filter(
        (choice): choice is string =>
          typeof choice === 'string' && choice.trim().length > 0,
      )
    : []

  return {
    clarifyId:
      readString(d.approval_id) ||
      readString(d.interaction_id) ||
      readString(d.clarify_id) ||
      approval.runId,
    sessionId,
    choices: choices.length ? choices : fallbackApprovalChoices(approval),
    question: readString(d.question) || approvalQuestion(approval),
    approval,
  }
}

export async function fetchPendingApprovals(
  profile: string | null,
): Promise<{ approvals: Array<PendingApprovalEntry>; unsupported: boolean }> {
  const query = profile ? `?profile=${encodeURIComponent(profile)}` : ''
  const res = await fetch(`/api/approvals/pending${query}`)
  const json = (await res.json().catch(() => ({}))) as {
    approvals?: Array<unknown>
    unsupported?: boolean
  }
  if (!res.ok) {
    // Catch-up is best-effort. A failing list must never break the chat, and
    // the live stream remains the primary source.
    return { approvals: [], unsupported: false }
  }
  const approvals = (json.approvals ?? [])
    .map(parsePendingApproval)
    .filter((entry): entry is PendingApprovalEntry => entry !== null)
  return { approvals, unsupported: json.unsupported === true }
}

export function usePendingApprovalQueue(): PendingApprovalQueue {
  const profile = getSessionProfile()
  const processEvent = useChatStore((s) => s.processEvent)

  const { data } = useQuery({
    queryKey: ['approvals', 'pending', profile ?? 'root'],
    queryFn: () => fetchPendingApprovals(profile),
    // Mount and reconnect are the two moments an approval can have been
    // missed. Focus covers the "came back to the tab" case.
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    retry: false,
  })

  const approvals = data?.approvals ?? EMPTY

  useEffect(() => {
    if (!approvals.length) return
    const held = useChatStore.getState().pendingClarify
    for (const entry of approvals) {
      // Skip anything the session already holds for this run, answered or
      // not: re-seeding would either duplicate a live card or resurrect one
      // the user just decided. The live stream owns the card while it exists.
      const alreadyHeld = Object.values(held).some(
        (card) => card?.approval?.runId === entry.approval.runId,
      )
      if (alreadyHeld) continue
      processEvent({
        type: 'clarify',
        // Catch-up is authoritative for a run the send-stream may also be
        // handling, so it must not be dropped by the send-stream dedup guard.
        transport: 'send-stream',
        clarifyId: entry.clarifyId,
        kind: 'approval',
        toolName: 'approval',
        question: entry.question,
        choices: entry.choices,
        approval: entry.approval,
        sessionKey: entry.sessionId,
        runId: entry.approval.runId,
      })
    }
  }, [approvals, processEvent])

  return useMemo(
    () => ({
      approvals,
      count: approvals.length,
      unsupported: data?.unsupported === true,
    }),
    [approvals, data?.unsupported],
  )
}

/** Scoped chat-store key for an approval's session — what the router needs. */
export function approvalSessionKey(entry: PendingApprovalEntry): string {
  return activeScopeKey(entry.sessionId)
}
