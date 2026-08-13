import { create } from 'zustand'

/**
 * Output cards for agent slash commands — deliberately **not** chat messages.
 *
 * `docs/plans/hermes-slash-commands-in-switchui.md` §5.11: the answer to
 * `/status` or `/tools` must not be sent to the model on the next turn and must
 * not enter session history. Three properties follow from keeping it here
 * rather than in the message list:
 *
 *   • It is never persisted — this store has no `persist` middleware, so a
 *     reload clears it.
 *   • It can never be picked up by the send path. `finalDisplayMessages` is
 *     what the composer and the transcript exporter read, and these entries are
 *     not in it — in fact `useDisplayMessages` filters out every role that is
 *     not `user`/`assistant`, so a synthetic message would have been dropped by
 *     the renderer while still being visible to anything that read the raw
 *     array. A separate store makes the invariant structural.
 *   • It is keyed by session, so switching chats does not carry output across.
 *
 * The rendered shape is a `<pre>` — see `command-output-card.tsx` and §7.3:
 * the agent hard-wraps its output to 120 columns and fills it with box-drawing
 * characters, so markdown rendering would mangle it.
 */

export type CommandOutputEntry = {
  id: string
  /** Canonical command, e.g. `/status`. */
  command: string
  /** Raw agent text. ANSI has already been stripped agent-side. */
  output: string
  /** Non-fatal agent warning (`_mirror_slash_side_effects` returns these). */
  warning?: string
  createdAt: number
}

/** Per session; oldest dropped past this. Output blocks are large. */
const MAX_PER_SESSION = 20

type State = {
  bySession: Record<string, Array<CommandOutputEntry>>
}

type Actions = {
  addOutput: (
    sessionKey: string | null | undefined,
    entry: Omit<CommandOutputEntry, 'id' | 'createdAt'> &
      Partial<Pick<CommandOutputEntry, 'id' | 'createdAt'>>,
  ) => void
  dismissOutput: (sessionKey: string | null | undefined, id: string) => void
  clearOutputs: (sessionKey: string | null | undefined) => void
}

/** Sessionless chats (a brand-new chat) still need somewhere to render. */
export const COMMAND_OUTPUT_FALLBACK_KEY = '__new__'

function keyOf(sessionKey: string | null | undefined): string {
  const trimmed = typeof sessionKey === 'string' ? sessionKey.trim() : ''
  return trimmed || COMMAND_OUTPUT_FALLBACK_KEY
}

let counter = 0

export const useCommandOutputStore = create<State & Actions>()((set) => ({
  bySession: {},

  addOutput: (sessionKey, entry) => {
    const key = keyOf(sessionKey)
    counter += 1
    const full: CommandOutputEntry = {
      id: entry.id ?? `cmd-${Date.now()}-${counter}`,
      command: entry.command,
      output: entry.output,
      ...(entry.warning ? { warning: entry.warning } : {}),
      createdAt: entry.createdAt ?? Date.now(),
    }
    set((state) => {
      const existing = state.bySession[key] ?? []
      const next = [...existing, full].slice(-MAX_PER_SESSION)
      return { bySession: { ...state.bySession, [key]: next } }
    })
  },

  dismissOutput: (sessionKey, id) => {
    const key = keyOf(sessionKey)
    set((state) => {
      const existing = state.bySession[key] as
        | Array<CommandOutputEntry>
        | undefined
      if (!existing) return state
      const next = existing.filter((entry) => entry.id !== id)
      return { bySession: { ...state.bySession, [key]: next } }
    })
  },

  clearOutputs: (sessionKey) => {
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
const EMPTY: ReadonlyArray<CommandOutputEntry> = []

export function selectCommandOutputs(
  state: State,
  sessionKey: string | null | undefined,
): ReadonlyArray<CommandOutputEntry> {
  return state.bySession[keyOf(sessionKey)] ?? EMPTY
}
