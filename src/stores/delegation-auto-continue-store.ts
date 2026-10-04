import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/**
 * Per-session opt-in: auto-send a short "continue" turn when an async
 * delegation completion lands while the chat is idle. Default off.
 *
 * The value is the time it was enabled (ms). Completion rows older than that
 * are never auto-continued, so turning it on does not fire on old orphans.
 */
type State = {
  enabledAt: Record<string, number>
}

type Actions = {
  setEnabled: (sessionKey: string, enabled: boolean) => void
}

export const useDelegationAutoContinueStore = create<State & Actions>()(
  persist(
    (set) => ({
      enabledAt: {},
      setEnabled: (sessionKey, enabled) => {
        if (!sessionKey) return
        set((state) => {
          const next = { ...state.enabledAt }
          if (enabled) next[sessionKey] = Date.now()
          else delete next[sessionKey]
          return { enabledAt: next }
        })
      },
    }),
    {
      name: 'hermes-delegation-auto-continue',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ enabledAt: state.enabledAt }),
    },
  ),
)
