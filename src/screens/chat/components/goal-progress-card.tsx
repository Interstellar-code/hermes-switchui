import {
  selectGoalProgress,
  useGoalProgressStore,
} from '../../../stores/goal-progress-store'
import type { GoalProgressEntry } from '../../../stores/goal-progress-store'

/**
 * The standing goal's judge trail, rendered next to the conversation but never
 * part of it.
 *
 * ── What this is ──────────────────────────────────────────────────────────
 * `/goal <text>` sets an objective the agent keeps working toward. After every
 * completed turn the gateway asks a judge whether to continue
 * (`_evaluate_goal_after_turn`, installed
 * `gateway/platforms/api_server.py:3544`) and streams the answer as
 * `goal.status`. Each line here is one such verdict, in order, with the turn
 * counter the judge itself reported.
 *
 * ── Why a sibling of the transcript, like `command-output-card` ───────────
 * The verdict is *about* the conversation, not part of it. Putting it in the
 * message list would feed it back to the model on the next turn and export it
 * with the transcript. See `stores/goal-progress-store.ts`.
 *
 * ── Why the turn counter is the headline ──────────────────────────────────
 * A goal spends real turns against a budget (20 by default over the dispatch
 * route, measured live). "3/20" is the number a user needs to decide whether
 * to let it run or `/goal pause`, and it is the one thing the judge's own
 * sentence does not always spell out.
 */

/** Status → the accent the row is drawn in. */
function toneOf(entry: GoalProgressEntry): {
  border: string
  background: string
  label: string
} {
  // A run that stopped without finishing (budget exhausted, or the
  // per-request cap) is neither success nor failure, and reads as neither.
  if (entry.status === 'done') {
    return {
      border: 'color-mix(in srgb, var(--theme-accent) 42%, transparent)',
      background: 'color-mix(in srgb, var(--theme-accent) 7%, transparent)',
      label: 'Goal achieved',
    }
  }
  if (!entry.shouldContinue) {
    return {
      border: 'color-mix(in srgb, var(--m-warn, #f59e0b) 42%, transparent)',
      background: 'color-mix(in srgb, var(--m-warn, #f59e0b) 7%, transparent)',
      label: entry.capped ? 'Goal paused (request limit)' : 'Goal stopped',
    }
  }
  return {
    border: 'var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
    background: 'var(--color-surface, var(--theme-card, rgba(0,0,0,0.15)))',
    label: 'Goal in progress',
  }
}

export function GoalProgressCard({
  entries,
  onDismiss,
}: {
  entries: ReadonlyArray<GoalProgressEntry>
  onDismiss?: () => void
}) {
  // Indexing is not proof of presence: an empty trail is the normal state and
  // this component is rendered unconditionally by the list's caller.
  const latest: GoalProgressEntry | undefined = entries.at(-1)
  if (!latest) return null
  const tone = toneOf(latest)

  return (
    <div
      data-testid="goal-progress-card"
      data-goal-status={latest.status}
      data-goal-turns={`${latest.turnsUsed}/${latest.maxTurns}`}
      className="mx-auto w-full max-w-3xl rounded-lg border px-3 py-2 my-2"
      style={{ borderColor: tone.border, background: tone.background }}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono font-semibold">/goal</span>
        <span
          className="text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--m-muted,var(--theme-muted,#6b7280))' }}
        >
          {tone.label}
        </span>
        {latest.maxTurns > 0 ? (
          <span
            className="text-[10px] font-mono"
            style={{ color: 'var(--m-muted,var(--theme-muted,#6b7280))' }}
          >
            {latest.turnsUsed}/{latest.maxTurns} turns
          </span>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            aria-label="Dismiss goal progress"
            className="ml-auto rounded px-1.5 py-0.5 text-[11px] underline-offset-2 hover:underline"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        ) : null}
      </div>

      <ol className="mt-1 space-y-0.5">
        {entries.map((entry) => (
          <li
            key={entry.id}
            data-testid="goal-progress-line"
            className="whitespace-pre-wrap text-[12px] leading-relaxed"
            style={{
              color:
                entry === latest
                  ? undefined
                  : 'var(--m-muted,var(--theme-muted,#6b7280))',
            }}
          >
            {entry.message}
          </li>
        ))}
      </ol>

      {!latest.shouldContinue && latest.status !== 'done' ? (
        <p
          className="mt-1 text-[11px]"
          style={{ color: 'var(--m-muted,var(--theme-muted,#6b7280))' }}
        >
          The goal is still set — `/goal resume` to keep going, `/goal clear` to
          drop it.
        </p>
      ) : null}
    </div>
  )
}

/** The goal trail for a session, or nothing when there is no goal running. */
export function GoalProgressList({
  sessionKey,
}: {
  sessionKey: string | null | undefined
}) {
  const entries = useGoalProgressStore((state) =>
    selectGoalProgress(state, sessionKey),
  )
  const clearGoalProgress = useGoalProgressStore(
    (state) => state.clearGoalProgress,
  )

  if (entries.length === 0) return null

  return (
    <GoalProgressCard
      entries={entries}
      onDismiss={() => clearGoalProgress(sessionKey)}
    />
  )
}
