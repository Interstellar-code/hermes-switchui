import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'

/**
 * Per-session overrides of the global "Show reasoning blocks" setting
 * (`useChatSettingsStore.settings.showReasoningBlocks`).
 *
 * The global setting stays the default; the composer's Brain toggle writes an
 * override scoped to the current chat's session key only.
 */
type SessionReasoningState = {
  /** session key → explicit show/hide for that chat (absent = follow global). */
  overrides: Record<string, boolean>
}

type SessionReasoningActions = {
  setOverride: (sessionKey: string, value: boolean) => void
  clearOverride: (sessionKey: string) => void
}

export type SessionReasoningStore = SessionReasoningState &
  SessionReasoningActions

/** Validate the persisted payload: keep only boolean entries. */
function mergePersistedOverrides(
  persistedState: unknown,
  currentState: SessionReasoningStore,
): SessionReasoningStore {
  const persisted = persistedState as { overrides?: unknown } | null | undefined
  const raw =
    persisted && typeof persisted === 'object' && persisted.overrides
      ? persisted.overrides
      : null
  const overrides: Record<string, boolean> = {}
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'boolean') overrides[key] = value
    }
  }
  return { ...currentState, overrides }
}

export const useSessionReasoningStore = create<SessionReasoningStore>()(
  persist(
    (set) => ({
      overrides: {},

      setOverride: (sessionKey, value) =>
        set((state) => ({
          overrides: { ...state.overrides, [sessionKey]: value },
        })),

      clearOverride: (sessionKey) =>
        set((state) => {
          if (!(sessionKey in state.overrides)) return state
          const overrides = { ...state.overrides }
          delete overrides[sessionKey]
          return { overrides }
        }),
    }),
    {
      name: 'switchui:session-reasoning',
      merge: (persistedState, currentState) =>
        mergePersistedOverrides(persistedState, currentState),
    },
  ),
)

/**
 * Effective "show reasoning" for one chat: the per-session override when set,
 * otherwise the global `showReasoningBlocks` default. Without a session key
 * (new unsaved chat) it is always the global value.
 */
export function useEffectiveShowReasoning(sessionKey?: string): boolean {
  const override = useSessionReasoningStore((state) =>
    sessionKey === undefined ? undefined : state.overrides[sessionKey],
  )
  const globalShowReasoningBlocks = useChatSettingsStore(
    (state) => state.settings.showReasoningBlocks,
  )
  return override ?? globalShowReasoningBlocks
}
