import { create } from 'zustand'

/** Keep the last N compactions per session; older ones only feed the count. */
export const MAX_COMPACTION_EVENTS = 20

export type CompactionEvent = {
  id: string
  /** ms epoch when the client learned of the compaction. */
  at: number
  messagesBefore: number | null
  messagesAfter: number | null
  contextPercent: number | null
  /** `auto` = agent compacted mid-turn; `manual` = Compress button. */
  source: 'auto' | 'manual'
}

type ContextUsageState = {
  sessionKey: string | null
  /** Other keys the same chat goes by (friendly id, canonical key, …). */
  sessionAliases: Array<string>
  contextPercent: number
  compactionCount: number
  compactionEvents: Array<CompactionEvent>
  /** ms epoch when a live compaction started, null when none is running. */
  compactingSince: number | null
  lastCompactionAt: number | null
  messagesBefore: number | null
  messagesAfter: number | null
}

type ContextUsageActions = {
  setSessionKey: (
    key: string | null,
    aliases?: Array<string | null | undefined>,
  ) => void
  recordCompaction: (payload: {
    sessionKey: string | null
    contextPercent?: number
    messagesBefore?: number
    messagesAfter?: number
    source?: CompactionEvent['source']
  }) => void
  startCompaction: (sessionKey: string | null) => void
  endCompaction: (sessionKey: string | null) => void
  updateContextPercent: (
    sessionKey: string | null,
    contextPercent: number,
  ) => void
  reset: () => void
}

const sessionResetState = {
  contextPercent: 0,
  compactionCount: 0,
  compactionEvents: [],
  compactingSince: null,
  lastCompactionAt: null,
  messagesBefore: null,
  messagesAfter: null,
} satisfies Omit<ContextUsageState, 'sessionKey' | 'sessionAliases'>

const initialState: ContextUsageState = {
  sessionKey: null,
  sessionAliases: [],
  ...sessionResetState,
}

/** True when `key` names the chat this store currently tracks. */
export function isTrackedContextSession(
  state: Pick<ContextUsageState, 'sessionKey' | 'sessionAliases'>,
  key: string | null | undefined,
): boolean {
  if (!key || !state.sessionKey) return key === state.sessionKey
  return key === state.sessionKey || state.sessionAliases.includes(key)
}

let compactionSeq = 0

export const useContextUsageStore = create<
  ContextUsageState & ContextUsageActions
>((set, get) => ({
  ...initialState,

  setSessionKey: (key, aliases = []) => {
    const nextAliases = Array.from(
      new Set(
        aliases.filter(
          (alias): alias is string =>
            typeof alias === 'string' && alias !== '' && alias !== key,
        ),
      ),
    )
    const s = get()
    if (s.sessionKey === key) {
      // Same chat — aliases may have resolved since (history loaded).
      if (nextAliases.some((alias) => !s.sessionAliases.includes(alias))) {
        set({
          sessionAliases: Array.from(
            new Set([...s.sessionAliases, ...nextAliases]),
          ),
        })
      }
      return
    }
    set({ sessionKey: key, sessionAliases: nextAliases, ...sessionResetState })
  },

  recordCompaction: ({
    sessionKey,
    contextPercent,
    messagesBefore,
    messagesAfter,
    source = 'auto',
  }) =>
    set((s) => {
      if (!isTrackedContextSession(s, sessionKey)) return {}
      const at = Date.now()
      const event: CompactionEvent = {
        id: `compaction-${at}-${++compactionSeq}`,
        at,
        messagesBefore: messagesBefore ?? null,
        messagesAfter: messagesAfter ?? null,
        contextPercent: contextPercent ?? null,
        source,
      }
      return {
        contextPercent: contextPercent ?? s.contextPercent,
        compactionCount: s.compactionCount + 1,
        compactionEvents: [...s.compactionEvents, event].slice(
          -MAX_COMPACTION_EVENTS,
        ),
        compactingSince: null,
        lastCompactionAt: at,
        messagesBefore: event.messagesBefore,
        messagesAfter: event.messagesAfter,
      }
    }),

  startCompaction: (sessionKey) =>
    set((s) => {
      if (!isTrackedContextSession(s, sessionKey)) return {}
      if (s.compactingSince !== null) return {}
      return { compactingSince: Date.now() }
    }),

  endCompaction: (sessionKey) =>
    set((s) => {
      if (!isTrackedContextSession(s, sessionKey)) return {}
      if (s.compactingSince === null) return {}
      return { compactingSince: null }
    }),

  updateContextPercent: (sessionKey, contextPercent) =>
    set((s) => {
      if (!isTrackedContextSession(s, sessionKey)) return {}
      return { contextPercent }
    }),

  reset: () => set(initialState),
}))
