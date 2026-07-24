/**
 * sessions-local-store.ts — Phase 2 of the Sessions Sidebar plan.
 *
 * Workspace-local pin/star/archive state for unified session items.
 * localStorage key: `hermes.sessions.local`
 * Schema version: 2
 *
 * IDs are namespaced: `{src}:{rawId}` (e.g. `chat:abc`, `task:t-1`).
 * Legacy `pinned-sessions` key stored bare chat session keys → migrate to `chat:{key}`.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LocalState = {
  version: 2
  /** Namespaced IDs. Stored as arrays (Sets don't serialize). */
  pinned: Array<string>
  starred: Array<string>
  archived: Array<string>
  /** Latest session update the user has opened, keyed by namespaced session ID. */
  lastSeenUpdate: Record<string, number>
  /** Avoid lighting up every pre-existing session when this feature first loads. */
  seenUpdatesInitialized: boolean
}

type LocalActions = {
  togglePinned: (id: string) => void
  toggleStarred: (id: string) => void
  toggleArchived: (id: string) => void
  /** Selectors — O(n) but sets are typically small. */
  isPinned: (id: string) => boolean
  isStarred: (id: string) => boolean
  isArchived: (id: string) => boolean
  initializeSeenUpdates: (sessions: Array<{ id: string; when: number }>) => void
  markSessionSeen: (id: string, when: number) => void
  markSessionsSeen: (
    sessions: Array<{ id: string; when: number; live: boolean }>,
  ) => void
}

const initialState: LocalState = {
  version: 2,
  pinned: [],
  starred: [],
  archived: [],
  lastSeenUpdate: {},
  seenUpdatesInitialized: false,
}

export function isSessionUpdateUnseen(
  id: string,
  when: number,
  state: Pick<LocalState, 'lastSeenUpdate' | 'seenUpdatesInitialized'>,
): boolean {
  if (!state.seenUpdatesInitialized) return false
  return when > (state.lastSeenUpdate[id] ?? 0)
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
      Array.isArray(parsed.state.pinnedSessionKeys)
    ) {
      keys = (parsed.state as { pinnedSessionKeys: Array<string> })
        .pinnedSessionKeys
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

      initializeSeenUpdates: (sessions) =>
        set((state) => {
          if (state.seenUpdatesInitialized) return state
          return {
            lastSeenUpdate: Object.fromEntries(
              sessions.map(({ id, when }) => [id, when]),
            ),
            seenUpdatesInitialized: true,
          }
        }),

      markSessionSeen: (id, when) =>
        set((state) => {
          if (state.lastSeenUpdate[id] >= when) return state
          return {
            lastSeenUpdate: { ...state.lastSeenUpdate, [id]: when },
          }
        }),

      markSessionsSeen: (sessions) =>
        set((state) => {
          const lastSeenUpdate = { ...state.lastSeenUpdate }
          let changed = !state.seenUpdatesInitialized
          for (const { id, when, live } of sessions) {
            if (live) continue
            if ((lastSeenUpdate[id] ?? 0) < when) {
              lastSeenUpdate[id] = when
              changed = true
            }
          }
          return changed
            ? { lastSeenUpdate, seenUpdatesInitialized: true }
            : state
        }),
    }),
    {
      name: 'hermes.sessions.local',
      version: 2,
      migrate: (persisted, _version) => {
        const stored = persisted as Partial<Omit<LocalState, 'version'>> & {
          version?: number
        }
        if (stored.version !== 1 && stored.version !== 2)
          return { ...initialState }
        return {
          ...initialState,
          pinned: Array.isArray(stored.pinned) ? stored.pinned : [],
          starred: Array.isArray(stored.starred) ? stored.starred : [],
          archived: Array.isArray(stored.archived) ? stored.archived : [],
          lastSeenUpdate:
            stored.version === 2 && stored.lastSeenUpdate
              ? stored.lastSeenUpdate
              : {},
          seenUpdatesInitialized:
            stored.version === 2 && stored.seenUpdatesInitialized === true,
        }
      },
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return
        // Migrate legacy pinned-sessions → namespaced ids (idempotent, one-shot).
        const legacy = readLegacyPinned()
        if (legacy.length === 0) return
        const existing = new Set(state.pinned)
        const toAdd = legacy.filter((id) => !existing.has(id))
        if (toAdd.length > 0) {
          useSessionsLocalStore.setState({
            pinned: [...state.pinned, ...toAdd],
          })
        }
        // Remove legacy key so migration only runs once.
        try {
          window.localStorage.removeItem('pinned-sessions')
        } catch {
          // ignore
        }
      },
    },
  ),
)
