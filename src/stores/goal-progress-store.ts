import { create } from 'zustand'

/**
 * The judge's verdict trail for a standing goal — live run state, not history.
 *
 * ── What produces these ───────────────────────────────────────────────────
 * `/goal <text>` sets an objective the agent works toward across turns
 * (`hermes_cli/goals.py`, stored in `state.db` under `goal:<session_key>`).
 * From agent v0.19.14 the gateway runs a judge after every completed turn
 * (`_evaluate_goal_after_turn`, installed
 * `gateway/platforms/api_server.py:3544`) and emits its verdict as a
 * `goal.status` SSE event, which `routes/api/send-stream.ts` re-emits as
 * `goal_status` and `use-streaming-message.ts` records here.
 *
 * Measured live on a throwaway session (2026-08-13), the three lines a user
 * actually sees are the judge's own text, already formatted:
 *
 *   ↻ Continuing toward goal (1/3): The agent has not begun the required count…
 *   ✓ Goal achieved …
 *   ⏸ Goal paused — 3/3 turns used. Use /goal resume to keep going, or /goal clear to stop.
 *
 * ── Why a store and not a chat message ────────────────────────────────────
 * Exactly the reasons `command-output-store.ts` gives, and it is deliberately
 * modelled on it:
 *
 *   • Never persisted — no `persist` middleware, so a reload clears it. The
 *     verdict describes a run, not the conversation.
 *   • Can never be picked up by the send path or the transcript exporter,
 *     which read `finalDisplayMessages`. A synthetic message would have been
 *     fed back to the model on the next turn — the judge's opinion of the
 *     agent's own output, re-injected as context.
 *   • Keyed by session, so switching chats does not carry a verdict across.
 *
 * ── Why the whole trail rather than the latest line ───────────────────────
 * A goal run is N turns and the interesting thing is the sequence: which turn
 * the judge let through, when the budget ran out, what it said each time. One
 * line would answer "what happened last" and lose "why are we on turn 4".
 * Capped, oldest dropped, because the budget can be 20 turns (the dispatch
 * path's default, measured) and every one of them lands a line here.
 */

export type GoalProgressEntry = {
  id: string
  /** The judge's own line — already user-facing text, rendered verbatim. */
  message: string
  /** `active` | `paused` | `done` | `cleared`, from the goal state machine. */
  status: string
  /** `continue` | `done` | … — the judge's raw verdict, when it sent one. */
  verdict?: string
  /** True while the run is going to take another turn on this goal. */
  shouldContinue: boolean
  /**
   * The per-REQUEST backstop fired (`MAX_GOAL_CONTINUATIONS_PER_REQUEST` = 10,
   * `api_server.py:243`) rather than the judge deciding. The goal is still
   * active; the user has to send another turn. Worth distinguishing because
   * "stopped" and "finished" look identical otherwise.
   */
  capped: boolean
  turnsUsed: number
  maxTurns: number
  runId?: string
  createdAt: number
}

/** Per session; oldest dropped past this. A 20-turn budget is 20 lines. */
const MAX_PER_SESSION = 24

type State = {
  bySession: Record<string, Array<GoalProgressEntry>>
}

type Actions = {
  addGoalStatus: (
    sessionKey: string | null | undefined,
    entry: Omit<GoalProgressEntry, 'id' | 'createdAt'> &
      Partial<Pick<GoalProgressEntry, 'id' | 'createdAt'>>,
  ) => void
  clearGoalProgress: (sessionKey: string | null | undefined) => void
}

/** Sessionless chats (a brand-new chat) still need somewhere to render. */
export const GOAL_PROGRESS_FALLBACK_KEY = '__new__'

function keyOf(sessionKey: string | null | undefined): string {
  const trimmed = typeof sessionKey === 'string' ? sessionKey.trim() : ''
  return trimmed || GOAL_PROGRESS_FALLBACK_KEY
}

let counter = 0

export const useGoalProgressStore = create<State & Actions>()((set) => ({
  bySession: {},

  addGoalStatus: (sessionKey, entry) => {
    const key = keyOf(sessionKey)
    counter += 1
    const full: GoalProgressEntry = {
      id: entry.id ?? `goal-${Date.now()}-${counter}`,
      message: entry.message,
      status: entry.status,
      ...(entry.verdict ? { verdict: entry.verdict } : {}),
      shouldContinue: entry.shouldContinue,
      capped: entry.capped,
      turnsUsed: entry.turnsUsed,
      maxTurns: entry.maxTurns,
      ...(entry.runId ? { runId: entry.runId } : {}),
      createdAt: entry.createdAt ?? Date.now(),
    }
    set((state) => {
      const existing = state.bySession[key] ?? []
      // The same verdict twice in a row is a re-delivery, not a second turn:
      // the gateway can repeat a status if a stream is retried, and two
      // identical lines read as two turns that both said the same thing.
      const last: GoalProgressEntry | undefined = existing.at(-1)
      if (
        last &&
        last.message === full.message &&
        last.turnsUsed === full.turnsUsed &&
        last.runId === full.runId
      ) {
        return state
      }
      const next = [...existing, full].slice(-MAX_PER_SESSION)
      return { bySession: { ...state.bySession, [key]: next } }
    })
  },

  clearGoalProgress: (sessionKey) => {
    const key = keyOf(sessionKey)
    set((state) => {
      if (!(key in state.bySession)) return state
      const next = { ...state.bySession }
      delete next[key]
      return { bySession: next }
    })
  },
}))

/** Read the entries for a session. Stable empty array so selectors don't churn. */
const EMPTY: ReadonlyArray<GoalProgressEntry> = []

export function selectGoalProgress(
  state: State,
  sessionKey: string | null | undefined,
): ReadonlyArray<GoalProgressEntry> {
  return state.bySession[keyOf(sessionKey)] ?? EMPTY
}
