import type { ChatMessage } from './types'

/**
 * An async-delegation delivery row (hermes-agent `append_delegation_delivery`).
 *
 * The gateway persists it as `role='user'` with the full results envelope as
 * text and `display_kind='async_delegation_complete'`. It is not something the
 * user typed, so the chat renders it as a card instead of a user bubble.
 * `display_metadata` is dropped by the gateway's message projection, so the
 * counts fall back to parsing the envelope header.
 */
export type DelegationCompletion = {
  delegationId: string | null
  /** True for the early "one task failed, siblings still running" notice. */
  isTaskFailure: boolean
  taskCount: number | null
  completedCount: number | null
  failedCount: number | null
  durationSeconds: number | null
  body: string
}

export const DELEGATION_DISPLAY_KIND = 'async_delegation_complete'
const HEADER_RE =
  /^\[ASYNC DELEGATION (BATCH COMPLETE|TASK FAILED) — ([^\]]*)\]/

function textOf(message: ChatMessage): string {
  if (typeof message.text === 'string' && message.text) return message.text
  const parts = Array.isArray(message.content) ? message.content : []
  return parts
    .map((part) =>
      part.type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : '',
    )
    .join('')
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function count(body: string, re: RegExp): number {
  return body.match(re)?.length ?? 0
}

export function parseDelegationCompletion(
  message: ChatMessage,
): DelegationCompletion | null {
  const body = textOf(message)
  const header = HEADER_RE.exec(body)
  if (message.displayKind !== DELEGATION_DISPLAY_KIND && !header) return null

  const meta =
    message.displayMetadata && typeof message.displayMetadata === 'object'
      ? message.displayMetadata
      : {}
  const headerId = header?.[2].match(/deleg_\w+/)?.[0] ?? null
  const isTaskFailure = header?.[1] === 'TASK FAILED'

  // Header fallback: "— 3 subagent(s) —", one "--- ✓ TASK i/n" / "--- ✗ TASK"
  // section per task, and "Total duration: 656.52s".
  const subagents = /(\d+) subagent\(s\)/.exec(body)
  const done = count(body, /^--- ✓ TASK /gm)
  const failed = count(body, /^--- ✗ TASK /gm)
  const duration = /Total duration: ([\d.]+)s/.exec(body)
  const parsedTasks = subagents
    ? Number(subagents[1])
    : done + failed > 0
      ? done + failed
      : isTaskFailure
        ? 1
        : null

  return {
    delegationId:
      typeof meta.delegation_id === 'string' ? meta.delegation_id : headerId,
    isTaskFailure,
    taskCount: num(meta.task_count) ?? parsedTasks,
    completedCount:
      num(meta.completed_count) ?? (done + failed > 0 ? done : null),
    failedCount:
      num(meta.failed_count) ??
      (done + failed > 0 ? failed : isTaskFailure ? 1 : null),
    durationSeconds:
      num(meta.duration_seconds) ?? (duration ? Number(duration[1]) : null),
    body,
  }
}

export function formatDelegationDuration(seconds: number): string {
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Short turn-starter. Never the envelope: hermes already folds the delivery
 * row into the next user message (`_merge_consecutive_users`). */
export const DELEGATION_CONTINUE_NUDGE =
  'Background delegation finished — continue with the results.'
