import { create } from 'zustand'

type ContextUsageState = {
  sessionKey: string | null
  contextPercent: number
  compactionCount: number
  lastCompactionAt: number | null
  messagesBefore: number | null
  messagesAfter: number | null
}

type ContextUsageActions = {
  setSessionKey: (key: string | null) => void
  recordCompaction: (payload: {
    sessionKey: string | null
    contextPercent: number
    messagesBefore?: number
    messagesAfter?: number
  }) => void
  updateContextPercent: (sessionKey: string | null, contextPercent: number) => void
  reset: () => void
}

const initialState: ContextUsageState = {
  sessionKey: null,
  contextPercent: 0,
  compactionCount: 0,
  lastCompactionAt: null,
  messagesBefore: null,
  messagesAfter: null,
}

export const useContextUsageStore = create<
  ContextUsageState & ContextUsageActions
>((set, get) => ({
  ...initialState,

  setSessionKey: (key) => {
    if (get().sessionKey === key) return
    set({
      sessionKey: key,
      contextPercent: 0,
      compactionCount: 0,
      lastCompactionAt: null,
      messagesBefore: null,
      messagesAfter: null,
    })
  },

  recordCompaction: ({ sessionKey, contextPercent, messagesBefore, messagesAfter }) =>
    set((s) => {
      if (s.sessionKey !== sessionKey) return {}
      return {
        contextPercent,
        compactionCount: s.compactionCount + 1,
        lastCompactionAt: Date.now(),
        messagesBefore: messagesBefore ?? null,
        messagesAfter: messagesAfter ?? null,
      }
    }),

  updateContextPercent: (sessionKey, contextPercent) =>
    set((s) => {
      if (s.sessionKey !== sessionKey) return {}
      return { contextPercent }
    }),

  reset: () => set(initialState),
}))
