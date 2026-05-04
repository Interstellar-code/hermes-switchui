import { create } from 'zustand'

type ContextUsageState = {
  contextPercent: number
  compactionCount: number
  lastCompactionAt: number | null
  messagesBefore: number | null
  messagesAfter: number | null
}

type ContextUsageActions = {
  recordCompaction: (payload: {
    contextPercent: number
    messagesBefore?: number
    messagesAfter?: number
  }) => void
  updateContextPercent: (contextPercent: number) => void
  reset: () => void
}

const initialState: ContextUsageState = {
  contextPercent: 0,
  compactionCount: 0,
  lastCompactionAt: null,
  messagesBefore: null,
  messagesAfter: null,
}

export const useContextUsageStore = create<
  ContextUsageState & ContextUsageActions
>((set) => ({
  ...initialState,

  recordCompaction: ({ contextPercent, messagesBefore, messagesAfter }) =>
    set((s) => ({
      contextPercent,
      compactionCount: s.compactionCount + 1,
      lastCompactionAt: Date.now(),
      messagesBefore: messagesBefore ?? null,
      messagesAfter: messagesAfter ?? null,
    })),

  updateContextPercent: (contextPercent) => set({ contextPercent }),

  reset: () => set(initialState),
}))
