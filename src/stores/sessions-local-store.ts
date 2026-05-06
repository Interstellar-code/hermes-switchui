/**
 * sessions-local-store.ts — Phase 2 of the Sessions Sidebar plan.
 *
 * Workspace-local pin/star/archive state for unified session items.
 * localStorage key: `hermes.sessions.local`
 * Schema version: 1
 *
 * IDs are namespaced: `{src}:{rawId}` (e.g. `chat:abc`, `task:t-1`).
 * Legacy `pinned-sessions` key stored bare chat session keys → migrate to `chat:{key}`.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LocalState = {
  version: 1
  /** Namespaced IDs. Stored as arrays (Sets don't serialize). */
  pinned: Array<string>
  starred: Array<string>
  archived: Array<string>
}

type LocalActions = {
  togglePinned: (id: string) => void
  toggleStarred: (id: string) => void
  toggleArchived: (id: string) => void
  /** Selectors — O(n) but sets are typically small. */
  isPinned: (id: string) => boolean
  isStarred: (id: string) => boolean
  isArchived: (id: string) => boolean
}

const initialState: LocalState = {
  version: 1,
  pinned: [],
  starred: [],
  archived: [],
}

/**
 * Exported for testing only.
 * Read legacy `pinned-sessions` localStorage entry and return namespaced IDs.
 * The legacy store held bare chat session keys (e.g. `abc123`), so we prefix
 * each with `chat:`. Returns [] if key is absent or unparseable.
 * Migration is idempotent: already-namespaced ids (containing ':') are kept as-is.
 */
export function readLegacyPinned(): Array<string> {
  try {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem('pinned-sessions')
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    // Zustand persist wraps state as `{ state: { pinnedSessionKeys: Array<string> } }`
    let keys: Array<string> = []
    if (
      parsed &&
      typeof parsed === 'object' &&
      'state' in parsed &&
      parsed.state &&
      typeof parsed.state === 'object' &&
      'pinnedSessionKeys' in parsed.state &&
      Array.isArray((parsed.state as { pinnedSessionKeys: unknown }).pinnedSessionKeys)
    ) {
      keys = (parsed.state as { pinnedSessionKeys: Array<string> }).pinnedSessionKeys
    } else if (Array.isArray(parsed)) {
      keys = parsed as Array<string>
    }
    return keys.map((k) => (k.includes(':') ? k : `chat:${k}`))
  } catch {
    return []
  }
}

export const useSessionsLocalStore = create<LocalState & LocalActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      togglePinned: (id) =>
        set((s) => ({
          pinned: s.pinned.includes(id)
            ? s.pinned.filter((x) => x !== id)
            : [...s.pinned, id],
        })),

      toggleStarred: (id) =>
        set((s) => ({
          starred: s.starred.includes(id)
            ? s.starred.filter((x) => x !== id)
            : [...s.starred, id],
        })),

      toggleArchived: (id) =>
        set((s) => ({
          archived: s.archived.includes(id)
            ? s.archived.filter((x) => x !== id)
            : [...s.archived, id],
        })),

      isPinned: (id) => get().pinned.includes(id),
      isStarred: (id) => get().starred.includes(id),
      isArchived: (id) => get().archived.includes(id),
    }),
    {
      name: 'hermes.sessions.local',
      version: 1,
      migrate: (persisted, _version) => {
        const stored = persisted as Partial<LocalState>
        if (stored.version !== 1) return { ...initialState }
        return stored as LocalState
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // Migrate legacy pinned-sessions → namespaced ids (idempotent).
        const legacy = readLegacyPinned()
        if (legacy.length === 0) return
        const existing = new Set(state.pinned)
        const toAdd = legacy.filter((id) => !existing.has(id))
        if (toAdd.length > 0) {
          state.pinned = [...state.pinned, ...toAdd]
        }
      },
    },
  ),
)
