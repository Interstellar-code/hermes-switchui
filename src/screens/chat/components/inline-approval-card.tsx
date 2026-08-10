import { useCallback, useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../../stores/chat-store'
import type { PendingClarify } from '../../../stores/chat-store'
import { cn } from '@/lib/utils'
import { profileBody } from '@/lib/session-scope'
import {
  ALWAYS_CONSEQUENCE,
  ALWAYS_REVOKE_HINT,
  APPROVAL_ALREADY_RESOLVED_NOTE,
  APPROVAL_EXPIRED_NOTE,
  approvalChoiceHint,
  approvalChoiceLabel,
  approvalChoiceWeight,
  approvalMsRemaining,
  formatApprovalCountdown,
  isPermanentChoice,
} from '@/lib/approvals'

type InlineApprovalCardProps = {
  clarify: PendingClarify
  sessionKey: string
}

/** Settings has no URL for its section — it reads this key on mount. */
const SETTINGS_SECTION_KEY = 'hermes.settings.section'

/**
 * Wraps at this length rather than being cut off. The command is NEVER
 * truncated: approving a shortened command is approving something unread. Past
 * this size the block is capped and scrollable, with an explicit expander —
 * every character stays reachable either way.
 */
const LONG_COMMAND_CHARS = 240

function isLongCommand(command: string): boolean {
  return command.length > LONG_COMMAND_CHARS || command.split('\n').length > 4
}

function formatError(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  return 'Approval request failed'
}

/**
 * Inline command-approval card (issue #353, approval contract v1 §5).
 *
 * Split out of `InlineClarifyCard` deliberately. A clarify is a question with
 * interchangeable answers, rendered as equal buttons plus a free-text escape.
 * An approval is a security decision where the options are NOT equal — one of
 * them writes a permanent, machine-wide allowlist entry — and where a
 * free-text answer is meaningless. Sharing the clarify renderer would have
 * made `always` look like a fourth ordinary button.
 */
export function InlineApprovalCard({
  clarify,
  sessionKey,
}: InlineApprovalCardProps) {
  const markClarifyResolved = useChatStore((s) => s.markClarifyResolved)
  const closeApprovalCard = useChatStore((s) => s.closeApprovalCard)

  const [submitting, setSubmitting] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmChoice, setConfirmChoice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const approval = clarify.approval
  const expiresAt = approval?.expiresAt
  const [msRemaining, setMsRemaining] = useState<number | null>(() =>
    approvalMsRemaining(expiresAt),
  )

  const resolved = !!clarify.resolved
  const clarifyId = clarify.clarifyId

  // The gateway emits NOTHING when an approval times out — it fail-closed
  // auto-denies and moves on (contract §4). A card left sitting there looks
  // live, and the eventual click gets a 409. This countdown is the only way
  // the user ever learns, so it self-closes rather than just greying out.
  useEffect(() => {
    if (resolved || !expiresAt) return
    const tick = () => {
      const remaining = approvalMsRemaining(expiresAt)
      setMsRemaining(remaining)
      if (remaining !== null && remaining <= 0) {
        closeApprovalCard(sessionKey, clarifyId, APPROVAL_EXPIRED_NOTE)
      }
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [resolved, expiresAt, sessionKey, clarifyId, closeApprovalCard])

  const submit = useCallback(
    async (choice: string) => {
      if (submittingRef.current || resolved || !approval?.runId) return
      submittingRef.current = true
      setSubmitting(choice)
      setError(null)

      try {
        // Keyed by run id only — the gateway ignores approval_id and pops the
        // run's oldest queue entry. The store guarantees one card per run so
        // this cannot answer the wrong request.
        const res = await fetch(
          `/api/runs/${encodeURIComponent(approval.runId)}/approval`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ choice, ...profileBody() }),
          },
        )
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          benign?: boolean
          error?: string
        }

        // 409/404 — already handled, run ended, or it timed out. Nothing is
        // broken and there is nothing left to do, so close with an
        // explanation instead of an error the user cannot act on.
        if (data.benign) {
          closeApprovalCard(
            sessionKey,
            clarifyId,
            APPROVAL_ALREADY_RESOLVED_NOTE,
          )
          return
        }

        if (!res.ok) {
          // A real failure: the decision was NOT recorded, so the card must
          // stay live and answerable.
          setError(data.error || `Approval failed (${res.status})`)
          return
        }

        markClarifyResolved(sessionKey, clarifyId, choice)
      } catch (err) {
        setError(formatError(err))
      } finally {
        submittingRef.current = false
        setSubmitting(null)
      }
    },
    [
      approval?.runId,
      clarifyId,
      closeApprovalCard,
      markClarifyResolved,
      resolved,
      sessionKey,
    ],
  )

  if (!approval) return null

  if (resolved) {
    const note = clarify.closedNote
    const picked = clarify.answer?.trim() ?? ''
    return (
      <div className="rounded-md border border-[color-mix(in_srgb,var(--theme-accent)_42%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent)_7%,transparent)] px-3 py-2.5">
        <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--theme-accent)]">
          <span aria-hidden>{note ? '!' : '✓'}</span>
          <span>{note ? 'Approval closed' : 'Approval recorded'}</span>
        </div>
        {approval.command ? (
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-[color-mix(in_srgb,var(--theme-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-bg)_72%,transparent)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--theme-text)]">
            {approval.command}
          </pre>
        ) : null}
        {note ? (
          <p className="mt-2 text-[11px] leading-relaxed text-[color-mix(in_srgb,var(--theme-text)_76%,transparent)]">
            {note}
          </p>
        ) : picked ? (
          <div className="mt-2 rounded-md border border-[var(--theme-accent)] bg-[color-mix(in_srgb,var(--theme-accent)_18%,transparent)] px-3 py-2 text-[12px] font-semibold leading-snug text-[var(--theme-text)] shadow-[inset_3px_0_0_var(--theme-accent)]">
            <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--theme-accent)]">
              Decision
            </span>
            <span>{approvalChoiceLabel(picked)}</span>
          </div>
        ) : null}
      </div>
    )
  }

  const choices = clarify.choices ?? []
  const command = approval.command ?? ''
  const long = isLongCommand(command)
  const countdown =
    msRemaining !== null ? formatApprovalCountdown(msRemaining) : null
  const expiringSoon = msRemaining !== null && msRemaining <= 10_000

  return (
    <div
      className={cn(
        'rounded-md border border-[color-mix(in_srgb,var(--theme-danger,#ef4444)_50%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger,#ef4444)_6%,transparent)] px-3 py-2.5 shadow-[0_0_18px_2px_color-mix(in_srgb,var(--theme-danger,#ef4444)_8%,transparent)] transition-all',
        submitting && 'opacity-70',
      )}
      role="group"
      aria-label="Approval required"
    >
      <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--theme-danger,#ef4444)]">
        <span aria-hidden>!</span>
        <span>Approval required</span>
        {approval.smartDenied ? (
          <span className="rounded border border-[color-mix(in_srgb,var(--theme-danger,#ef4444)_50%,transparent)] px-1.5 py-0.5 text-[9px] tracking-[0.1em]">
            Flagged unsafe
          </span>
        ) : null}
        {countdown ? (
          <span
            role="timer"
            aria-live="off"
            className={cn(
              'ml-auto tabular-nums',
              expiringSoon
                ? 'text-[var(--theme-danger,#ef4444)]'
                : 'text-[var(--theme-muted)]',
            )}
          >
            {countdown} left
          </span>
        ) : null}
      </div>

      {approval.description ? (
        <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--theme-text)]">
          {approval.description}
        </p>
      ) : null}

      {command ? (
        <>
          <pre
            data-testid="approval-command"
            className={cn(
              'mt-2 whitespace-pre-wrap break-words rounded-md border border-[color-mix(in_srgb,var(--theme-danger,#ef4444)_35%,transparent)] bg-[color-mix(in_srgb,var(--theme-bg)_78%,transparent)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--theme-text)]',
              long && !expanded && 'max-h-40 overflow-y-auto',
            )}
          >
            {command}
          </pre>
          {long ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-muted)] underline underline-offset-2 hover:text-[var(--theme-text)]"
            >
              {expanded ? 'Collapse command' : 'Expand full command'}
            </button>
          ) : null}
        </>
      ) : null}

      {approval.patternKeys?.length ? (
        <p className="mt-2 font-mono text-[10px] text-[var(--theme-muted)]">
          Pattern: {approval.patternKeys.join(', ')}
        </p>
      ) : null}

      {confirmChoice ? (
        <div className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--theme-danger,#ef4444)_55%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger,#ef4444)_10%,transparent)] px-3 py-2.5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--theme-danger,#ef4444)]">
            Confirm permanent allowlist
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--theme-text)]">
            {ALWAYS_CONSEQUENCE}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--theme-muted)]">
            {ALWAYS_REVOKE_HINT}{' '}
            <a
              href="/settings"
              onClick={() => {
                // Settings picks its section from localStorage, not the URL,
                // so seed it rather than shipping the user to whatever section
                // they last had open.
                try {
                  localStorage.setItem(SETTINGS_SECTION_KEY, 'safety')
                } catch {
                  // Settings still opens; it just lands on its last section.
                }
              }}
              className="underline underline-offset-2 hover:text-[var(--theme-text)]"
            >
              Open Settings → Safety
            </a>
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!!submitting}
              onClick={() => {
                const choice = confirmChoice
                setConfirmChoice(null)
                void submit(choice)
              }}
              className="rounded-md border border-[var(--theme-danger,#ef4444)] bg-[color-mix(in_srgb,var(--theme-danger,#ef4444)_22%,transparent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--theme-text)] transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {`Yes — ${approvalChoiceLabel(confirmChoice).toLowerCase()}, permanently`}
            </button>
            <button
              type="button"
              onClick={() => setConfirmChoice(null)}
              className="rounded-md px-2 py-1.5 text-[11px] font-medium text-[var(--theme-muted)] underline underline-offset-2 hover:text-[var(--theme-text)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {choices.map((choice) => {
            const weight = approvalChoiceWeight(choice)
            const permanent = isPermanentChoice(choice)
            return (
              <button
                key={choice}
                type="button"
                disabled={!!submitting}
                title={approvalChoiceHint(choice) ?? undefined}
                onClick={() => {
                  // `always` writes a machine-wide allowlist keyed by pattern
                  // CATEGORY — it silently pre-approves commands nobody has
                  // seen. It gets a confirmation step, and never resolves on
                  // first click.
                  if (permanent) {
                    setConfirmChoice(choice)
                    return
                  }
                  void submit(choice)
                }}
                className={cn(
                  'rounded-md px-3 py-1.5 text-[11px] font-semibold transition-opacity hover:opacity-85 disabled:opacity-50',
                  weight === 'primary' &&
                    'border border-[var(--theme-accent)] bg-[color-mix(in_srgb,var(--theme-accent)_20%,transparent)] text-[var(--theme-text)]',
                  weight === 'quiet' &&
                    'border border-[color-mix(in_srgb,var(--theme-muted)_45%,transparent)] bg-transparent font-medium text-[var(--theme-text)]',
                  // Deliberately the quietest affordance on the card: no fill,
                  // muted text, smaller weight. It must not read as a peer of
                  // Allow once.
                  weight === 'permanent' &&
                    'border border-dashed border-[color-mix(in_srgb,var(--theme-muted)_40%,transparent)] bg-transparent text-[11px] font-medium text-[var(--theme-muted)] hover:text-[var(--theme-text)]',
                )}
              >
                {submitting === choice
                  ? 'Sending…'
                  : approvalChoiceLabel(choice)}
              </button>
            )
          })}
        </div>
      )}

      {error ? (
        <p className="mt-2 text-[11px] font-medium text-[var(--theme-danger,#ef4444)]">
          {error}
        </p>
      ) : null}
    </div>
  )
}
