/**
 * Command-approval wire helpers (approval contract v1).
 *
 * The gateway blocks an agent turn on a dangerous command and asks the human.
 * This fork carries that request on the sessions chat stream as a `clarify`
 * event with `kind: "approval"` — see `approval-contract-v1.md` §1 — so the
 * whole thing reuses the clarify pipeline instead of inventing a second one.
 *
 * Everything here is pure and wire-shaped: one parser for the snake_case
 * payload (which arrives from BOTH the stream and `GET /v1/approvals/pending`),
 * plus the copy and semantics for the four choices. No fetching, no React.
 */

/**
 * The approval half of a `kind: "approval"` clarify. Lives alongside the
 * clarify fields on `PendingClarify` rather than in a parallel store.
 */
export type PendingApprovalDetail = {
  /**
   * REQUIRED. Resolution is `POST /v1/runs/{run_id}/approval` and is keyed by
   * run id ALONE — the gateway never reads `approval_id`, it pops the oldest
   * queue entry FIFO. That is why `runId` is the identity here and why at most
   * one card per run may ever be outstanding (contract §2).
   */
  runId: string
  /**
   * The command, already redacted twice server-side. Display only — never
   * echo it back as something to run. Rendered verbatim and untruncated:
   * approving a shortened command is approving something unread.
   */
  command?: string
  description?: string
  patternKey?: string
  /**
   * Allowlist keys, NOT command text. `always` persists these, so one click
   * can auto-approve a whole category of commands the user has never seen.
   */
  patternKeys?: Array<string>
  /** False when a tirith finding is present — `always` is then inappropriate. */
  allowPermanent?: boolean
  /** Present ONLY when true (contract §1). Never test with `!== false`. */
  smartDenied?: boolean
  /**
   * Absolute ISO-8601 expiry. The gateway emits NO event when an approval
   * times out and fail-closed auto-denies, so a client-side countdown against
   * this value is the only way the user ever learns (contract §4).
   */
  expiresAt?: string
}

/** The four choices the gateway accepts. Rendered from the event, never hardcoded. */
export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'

const CHOICE_LABELS: Record<ApprovalChoice, string> = {
  once: 'Allow once',
  session: 'Allow for this session',
  always: 'Always allow',
  deny: 'Deny',
}

const CHOICE_HINTS: Record<ApprovalChoice, string> = {
  once: 'Run this command now. Nothing is remembered.',
  session: 'Stop asking for this pattern until the session ends.',
  always: 'Write this pattern to ~/.hermes/config.yaml, permanently.',
  deny: 'Refuse. The agent is told not to retry or rephrase.',
}

/**
 * Consequence copy for `always`, shown in its confirmation step. It names what
 * actually happens rather than what the button says: `always` writes
 * `command_allowlist` by PATTERN CATEGORY, which short-circuits danger
 * classification for every future command in that category, in every session,
 * machine-wide. It is a security grant, not a convenience toggle.
 */
export const ALWAYS_CONSEQUENCE =
  'This will stop asking for this pattern, including commands you have not seen yet. It is written to ~/.hermes/config.yaml and applies to every future session on this machine.'

/** Where a permanent grant can be reviewed and revoked, per entry. */
export const ALWAYS_REVOKE_HINT = 'Review or revoke under Settings → Safety.'

export function isApprovalChoice(value: string): value is ApprovalChoice {
  return (
    value === 'once' || value === 'session' || value === 'always' || value === 'deny'
  )
}

/** `always` is the only choice that persists outside the session. */
export function isPermanentChoice(value: string): boolean {
  return value.trim().toLowerCase() === 'always'
}

export function approvalChoiceLabel(value: string): string {
  const key = value.trim().toLowerCase()
  return isApprovalChoice(key) ? CHOICE_LABELS[key] : value
}

export function approvalChoiceHint(value: string): string | null {
  const key = value.trim().toLowerCase()
  return isApprovalChoice(key) ? CHOICE_HINTS[key] : null
}

/**
 * Deny reads as the safe fallback, so it is styled as the quiet escape rather
 * than a destructive action; `once`/`session` are the ordinary affordances.
 */
export function approvalChoiceWeight(
  value: string,
): 'primary' | 'quiet' | 'permanent' {
  const key = value.trim().toLowerCase()
  if (key === 'always') return 'permanent'
  if (key === 'deny') return 'quiet'
  return 'primary'
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringList(value: unknown): Array<string> | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return list.length ? list : undefined
}

/**
 * Parse the approval half of a wire payload. Accepts both the snake_case the
 * gateway emits and the camelCase the workspace stream layer may already have
 * normalised, because the same payload shape arrives from the chat stream and
 * from `GET /v1/approvals/pending`.
 *
 * Returns `null` without a `run_id`: an approval that cannot be resolved must
 * not be rendered as if it could be.
 */
export function parseApprovalDetail(raw: unknown): PendingApprovalDetail | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>

  const runId = readString(d.run_id) || readString(d.runId)
  if (!runId) return null

  const patternKeys =
    readStringList(d.pattern_keys) ?? readStringList(d.patternKeys)
  const patternKey = readString(d.pattern_key) || readString(d.patternKey)

  // `allow_permanent` is read defensively gateway-side as "missing counts as
  // true", so mirror that rather than defaulting to false and silently hiding
  // a choice the gateway did offer.
  const rawAllowPermanent = d.allow_permanent ?? d.allowPermanent
  const allowPermanent = rawAllowPermanent === undefined ? undefined : rawAllowPermanent !== false

  // `smart_denied` is ABSENT, not false, in the normal case.
  const smartDenied =
    d.smart_denied === true || d.smartDenied === true ? true : undefined

  return {
    runId,
    command: readString(d.command) || undefined,
    description: readString(d.description) || undefined,
    patternKey: patternKey || undefined,
    patternKeys,
    allowPermanent,
    smartDenied,
    expiresAt: readString(d.expires_at) || readString(d.expiresAt) || undefined,
  }
}

/**
 * The choices the gateway would offer for this approval. Used ONLY as a
 * fallback when a payload arrives without a `choices` array — the event's own
 * array is authoritative and is what the card renders. Mirrors
 * `_approval_event_choices` (contract §1).
 */
export function fallbackApprovalChoices(
  detail: Pick<PendingApprovalDetail, 'smartDenied' | 'allowPermanent'>,
): Array<ApprovalChoice> {
  if (detail.smartDenied) return ['once', 'deny']
  if (detail.allowPermanent === false) return ['once', 'session', 'deny']
  return ['once', 'session', 'always', 'deny']
}

/**
 * The question line for an approval card. The gateway's approval payload has
 * no `question` field — it has `description` and `command` — but the clarify
 * pipeline requires a non-empty question (the store drops empty ones).
 */
export function approvalQuestion(detail: PendingApprovalDetail): string {
  return (
    detail.description ||
    (detail.command ? 'Approve this command?' : 'Approve this action?')
  )
}

/** Milliseconds until `expiresAt`, or `null` when there is no deadline. */
export function approvalMsRemaining(
  expiresAt: string | undefined,
  now: number = Date.now(),
): number | null {
  if (!expiresAt) return null
  const deadline = Date.parse(expiresAt)
  if (Number.isNaN(deadline)) return null
  return deadline - now
}

/** `0:07` style countdown. Clamped at zero — never renders a negative clock. */
export function formatApprovalCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Copy shown once the client-side countdown lapses. */
export const APPROVAL_EXPIRED_NOTE =
  'Timed out. The gateway auto-denied this request — silence is not consent — and the agent was told not to retry.'

/** Copy for a 409/404 from the resolve endpoint: gone, not broken. */
export const APPROVAL_ALREADY_RESOLVED_NOTE =
  'This approval was already handled — answered elsewhere, timed out, or the run ended.'
