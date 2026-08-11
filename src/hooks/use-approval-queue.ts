/**
 * Cross-session view of blocking command approvals, plus catch-up.
 *
 * An approval is emitted on the chat stream exactly once and is never
 * re-sent — not on reconnect, not in any status payload. A refresh mid-approval
 * would otherwise leave the agent blocked against a card nobody can see, until
 * it silently auto-denied. `GET /api/approvals/pending` is the recovery path;
 * this hook is the only caller.
 *
 * It does three things and no more:
 *   1. Seeds recovered approvals back into the chat store, so the card
 *      re-renders in the chat it belongs to.
 *   2. Exposes the list so the bell can show a count and point at it.
 *   3. Reconciles: closes a card whose approval fell out of the list (#17).
 *
 * It deliberately does NOT resolve anything. A decision made from a list, away
 * from the command and its context, is exactly the approval-by-reflex this
 * feature exists to prevent — and a second resolve surface would race the card
 * for a queue the gateway pops FIFO.
 *
 * More on (3): an approval with no `expires_at` has no
 * client-side countdown and is deliberately exempt from the stream-error
 * clears in `use-streaming-message.ts` (a dead stream must not orphan a card
 * the gateway is still blocked on) — so before this, such a card had NO
 * removal path at all if the gateway resolved or auto-denied it without the
 * client seeing a live event. This poll is the natural authority: it is the
 * same list `GET /v1/approvals/pending` builds from the gateway's live queue,
 * so an approval missing from it really is gone. Two things this must never
 * do: (1) treat a FAILED poll as "nothing pending" — `fetchPendingApprovals`
 * swallows a non-2xx into the same empty-list shape as a genuine empty
 * answer, so `ok` distinguishes them; (2) race a card's own resolve POST —
 * `markApprovalSubmitting`/`clearApprovalSubmitting` below are a plain
 * module-level guard (not store state) that `InlineApprovalCard` holds for
 * the span of its own `fetch`, so a poll landing mid-submit skips that run
 * rather than closing the card out from under the request already in flight.
 *
 * A past bug here: two `useQuery` calls sharing one queryKey (this hook is
 * called from both `approvals-bell.tsx` and `chat-screen.tsx`) must register
 * the SAME `queryFn` and effect logic, or behavior silently depends on mount
 * order / which instance's cache entry wins. Keep this a single hook body —
 * do not fork the query definition per call site.
 */
import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PendingApprovalDetail } from '@/lib/approvals'
import { useChatStore } from '@/stores/chat-store'
import { activeScopeKey, getSessionProfile, parseScopeKey } from '@/lib/session-scope'
import {
  APPROVAL_ALREADY_RESOLVED_NOTE,
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

export type PendingApprovalsFetchResult = {
  approvals: Array<PendingApprovalEntry>
  unsupported: boolean
  /**
   * False when the gateway call itself failed (non-2xx or unparseable body)
   * and `approvals: []` above is a placeholder, NOT a real "nothing
   * pending" answer. Reconciliation (below) must gate on this — an empty
   * list from a failed poll is not evidence that anything was resolved.
   */
  ok: boolean
}

export async function fetchPendingApprovals(
  profile: string | null,
): Promise<PendingApprovalsFetchResult> {
  const query = profile ? `?profile=${encodeURIComponent(profile)}` : ''
  const res = await fetch(`/api/approvals/pending${query}`)
  const json = (await res.json().catch(() => ({}))) as {
    approvals?: Array<unknown>
    unsupported?: boolean
  }
  if (!res.ok) {
    // Catch-up is best-effort. A failing list must never break the chat, and
    // the live stream remains the primary source. `ok: false` marks this so
    // it is never mistaken for a genuine empty list.
    return { approvals: [], unsupported: false, ok: false }
  }
  const approvals = (json.approvals ?? [])
    .map(parsePendingApproval)
    .filter((entry): entry is PendingApprovalEntry => entry !== null)
  return { approvals, unsupported: json.unsupported === true, ok: true }
}

// Run ids currently mid-submit in `InlineApprovalCard`'s own resolve POST
// (issue #17). Plain module state, not chat-store state: this coordinates
// the poll below with the one card resolving a given run, and has no
// business being persisted, serialized, or driving a re-render. Held only
// for the span of the fetch — see `InlineApprovalCard`'s `submit`.
const submittingApprovalRunIds = new Set<string>()

/** Called by `InlineApprovalCard` before it POSTs a resolve for `runId`. */
export function markApprovalSubmitting(runId: string): void {
  submittingApprovalRunIds.add(runId)
}

/** Called by `InlineApprovalCard` once its resolve POST settles. */
export function clearApprovalSubmitting(runId: string): void {
  submittingApprovalRunIds.delete(runId)
}

// A tab that stays focused and never loses connection never hits mount,
// reconnect, or focus — and that's exactly the case where a missed
// `clarify` event would otherwise sit invisible until the gateway
// auto-denies it. This is the polling backstop for that gap: normal cadence
// while the queue is empty, tighter once something is actually waiting on
// the user. `/api/approvals/pending` times out its gateway call at 10s
// (routes/api/approvals.pending.ts), so neither cadence may go below that.
const POLL_INTERVAL_IDLE_MS = 15_000
const POLL_INTERVAL_PENDING_MS = 10_000

export function approvalPollInterval(query: {
  state: { data?: { approvals: Array<unknown> } }
}): number {
  const pending = query.state.data?.approvals.length ?? 0
  return pending > 0 ? POLL_INTERVAL_PENDING_MS : POLL_INTERVAL_IDLE_MS
}

export function usePendingApprovalQueue(): PendingApprovalQueue {
  const profile = getSessionProfile()
  const processEvent = useChatStore((s) => s.processEvent)

  const { data } = useQuery({
    queryKey: ['approvals', 'pending', profile ?? 'root'],
    queryFn: () => fetchPendingApprovals(profile),
    // Mount and reconnect are the two moments an approval can have been
    // missed. Focus covers the "came back to the tab" case. `refetchInterval`
    // below covers the rest — see its comment.
    refetchInterval: approvalPollInterval,
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

  // Reconciliation (#17). An approval absent from a SUCCESSFUL,
  // catch-up-capable pending list has been resolved elsewhere or auto-denied
  // by the gateway's own timeout — the only removal path a card with no
  // `expires_at` ever had. Gated on `ok` (never act on a failed poll) and
  // `!unsupported` (an ever-empty list from a gateway build with no
  // catch-up endpoint is not evidence of anything). Scoped to the polled
  // profile only — the store can hold cards for other profiles the current
  // poll never asked about, and an empty list from THIS poll says nothing
  // about THOSE. Skips `resolved` cards (the user/countdown already closed
  // it) and any run `InlineApprovalCard` is mid-submit for, so a poll
  // landing between the resolve POST firing and its response does not stomp
  // the real answer with a generic "already handled" note.
  useEffect(() => {
    if (!data?.ok || data.unsupported) return
    const closeApprovalCard = useChatStore.getState().closeApprovalCard
    const held = useChatStore.getState().pendingClarify
    const liveRunIds = new Set(approvals.map((entry) => entry.approval.runId))
    for (const [sessionKey, pending] of Object.entries(held)) {
      if (
        !pending ||
        pending.kind !== 'approval' ||
        !pending.approval ||
        pending.resolved
      ) {
        continue
      }
      if (parseScopeKey(sessionKey).profile !== profile) continue
      const runId = pending.approval.runId
      if (liveRunIds.has(runId) || submittingApprovalRunIds.has(runId)) continue
      closeApprovalCard(
        parseScopeKey(sessionKey).sessionId,
        pending.clarifyId,
        APPROVAL_ALREADY_RESOLVED_NOTE,
      )
    }
  }, [data?.ok, data?.unsupported, approvals, profile])

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
