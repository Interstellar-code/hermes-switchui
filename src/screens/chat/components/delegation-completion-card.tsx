import { useId, useState } from 'react'

import { formatDelegationDuration } from '../delegation-completion'
import type { ReactNode } from 'react'
import type { DelegationCompletion } from '../delegation-completion'
import { Markdown } from '@/components/prompt-kit/markdown'
import { writeTextToClipboard } from '@/lib/clipboard'

const MUTED = 'var(--m-muted,var(--theme-muted,#6b7280))'

/**
 * An async-delegation delivery row. It is stored as a `user` message but was
 * written by the gateway, so it renders as a centered system card — never a
 * user bubble — collapsed by default because the body is often 9+ KB.
 */
export function DelegationCompletionCard({
  completion,
  actions,
}: {
  completion: DelegationCompletion
  /** Continue / auto-continue controls; only passed for the last card. */
  actions?: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const bodyId = useId()
  const { taskCount, completedCount, failedCount, durationSeconds } = completion
  const failed = failedCount ?? 0
  const tasks =
    taskCount === null
      ? null
      : `${completedCount === null ? '' : `${completedCount}/`}${taskCount} task${taskCount === 1 ? '' : 's'}`

  return (
    <div
      data-testid="delegation-completion-card"
      data-delegation-id={completion.delegationId ?? undefined}
      className="mx-auto w-full max-w-3xl rounded-lg border px-3 py-2"
      style={{
        borderColor:
          'var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
        background: 'var(--color-surface, var(--theme-card, rgba(0,0,0,0.15)))',
      }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? bodyId : undefined}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-xs"
      >
        <span aria-hidden>🛰</span>
        <span className="font-medium">
          {completion.isTaskFailure
            ? 'Background task failed'
            : 'Background delegation finished'}
        </span>
        {tasks ? <span style={{ color: MUTED }}>· {tasks}</span> : null}
        {failed > 0 ? (
          <span
            data-testid="delegation-failed-count"
            style={{ color: 'var(--m-danger, var(--theme-danger, #ef4444))' }}
          >
            · {failed} failed
          </span>
        ) : null}
        {durationSeconds !== null ? (
          <span style={{ color: MUTED }}>
            · {formatDelegationDuration(durationSeconds)}
          </span>
        ) : null}
        <span className="ml-auto text-[11px]" style={{ color: MUTED }}>
          {expanded ? 'Hide' : 'Show results'}
        </span>
      </button>
      {expanded ? (
        <div
          id={bodyId}
          data-testid="delegation-completion-body"
          className="mt-2 max-h-96 overflow-y-auto border-t pt-2"
          style={{
            borderColor:
              'var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
          }}
        >
          <button
            type="button"
            data-testid="delegation-copy"
            onClick={() => {
              writeTextToClipboard(completion.body).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }}
            className="float-right ml-2 rounded px-1.5 py-0.5 text-[11px] hover:underline"
            style={{ color: MUTED }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <Markdown className="text-sm">{completion.body}</Markdown>
        </div>
      ) : null}
      {actions ? <div className="mt-2">{actions}</div> : null}
    </div>
  )
}

export function DelegationCardActions({
  canContinue,
  onContinue,
  autoContinue,
  onAutoContinueChange,
}: {
  canContinue: boolean
  onContinue: () => void
  autoContinue: boolean
  onAutoContinueChange: (enabled: boolean) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {canContinue ? (
        <button
          type="button"
          data-testid="delegation-continue"
          onClick={onContinue}
          className="rounded border px-2 py-0.5 font-medium hover:opacity-80"
          style={{
            borderColor:
              'color-mix(in srgb, var(--theme-accent) 42%, transparent)',
            background:
              'color-mix(in srgb, var(--theme-accent) 10%, transparent)',
          }}
        >
          Continue with results
        </button>
      ) : null}
      <label
        className="flex cursor-pointer items-center gap-1.5"
        style={{ color: MUTED }}
      >
        <input
          type="checkbox"
          data-testid="delegation-auto-continue"
          checked={autoContinue}
          onChange={(e) => onAutoContinueChange(e.target.checked)}
        />
        Auto-continue when background tasks finish
      </label>
    </div>
  )
}
