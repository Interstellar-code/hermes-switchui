/**
 * sessions-filter-store.ts — Phase 2 of the Sessions Sidebar plan.
 *
 * Persisted filter state for the unified sessions sidebar.
 * localStorage key: `hermes.sessions.filter`
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SessionDateRange, SessionFeedSort, SessionSource, SessionState } from '@/screens/chat/sessions-feed-types'
import { UNSCOPED_PROFILE, setDeviceSessionProfile } from '@/lib/session-scope'

export { UNSCOPED_PROFILE }

export type FilterState = {
  version: 8
  /** Multi-select; empty array = all sources (no implicit "All" chip). */
  sources: Array<SessionSource>
  /** Single-select; kept for compatibility, sidebar uses all. */
  state: SessionState | 'all'
  /** Search text; debounce handled at consumer. */
  query: string
  /** ISO 8601 date range. */
  dateRange: SessionDateRange
  /** Sort order. */
  sort: SessionFeedSort
  /** Show only settled sessions with an update that has not been opened. */
  updatesOnly: boolean
  /** Sidebar collapsed state. */
  collapsed: boolean
  /** Which panel renders in the left column: sessions list or file explorer. */
  leftPanel: 'sessions' | 'files'
  /**
   * The profile this device is working in — the sidebar dropdown's selection.
   * `UNSCOPED_PROFILE` (`'active'`) = no selection: the gateway's current
   * profile, read unscoped, byte-identical to pre-P2 behaviour.
   *
   * NOT just a list filter. Since v8 this field is the **device layer** of the
   * one profile resolver in `lib/session-scope.ts` (`url ?? device ?? null`):
   * it is published to `setDeviceSessionProfile` below, so a profile picked
   * here also scopes the query keys and the request bodies of anything the URL
   * has not already pinned. That is the point — a selection that changed the
   * session list but not where the composer sent was the bug this replaced.
   *
   * `'default'` here means the profile literally named `default`, which is a
   * real, servable profile under a multiplex gateway. Only the sentinel means
   * unscoped.
   */
  profile: string
}

type FilterActions = {
  toggleSource: (src: SessionSource) => void
  setState: (s: SessionState | 'all') => void
  setQuery: (q: string) => void
  setDateRange: (from: string | null, to: string | null) => void
  setSort: (s: SessionFeedSort) => void
  toggleUpdatesOnly: () => void
  setCollapsed: (b: boolean) => void
  setLeftPanel: (p: 'sessions' | 'files') => void
  setProfile: (p: string) => void
  reset: () => void
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function buildDefaultDateRange(): SessionDateRange {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - 7)
  return { from: toISODate(from), to: toISODate(now) }
}

function buildInitialState(): FilterState {
  return {
    version: 8,
    sources: [],
    state: 'all',
    query: '',
    dateRange: buildDefaultDateRange(),
    sort: 'recent',
    updatesOnly: false,
    collapsed: false,
    leftPanel: 'sessions',
    profile: UNSCOPED_PROFILE,
  }
}

const initialState: FilterState = buildInitialState()

export const useSessionsFilterStore = create<FilterState & FilterActions>()(
  persist(
    (set) => ({
      ...initialState,

      toggleSource: (src) =>
        set((s) => ({
          sources: s.sources.includes(src)
            ? s.sources.filter((x) => x !== src)
            : [...s.sources, src],
        })),

      setState: (state) => set({ state }),

      setQuery: (query) => set({ query }),

      setDateRange: (from, to) => set({ dateRange: { from, to } }),

      setSort: (sort) => set({ sort }),

      toggleUpdatesOnly: () =>
        set((state) => ({ updatesOnly: !state.updatesOnly })),

      setCollapsed: (collapsed) => set({ collapsed }),

      setLeftPanel: (leftPanel) => set({ leftPanel }),

      setProfile: (profile) => set({ profile }),

      reset: () => set(buildInitialState()),
    }),
    {
      name: 'hermes.sessions.filter',
      migrate: (persisted, _version) => {
        const stored = (persisted ?? {}) as Partial<FilterState> & { version?: number }
        const v = Number(stored.version) || 0
        const defaults = buildInitialState()
        const storedDateRange = stored.dateRange ?? { from: null, to: null }
        const hasExplicitDateRange = Boolean(storedDateRange.from || storedDateRange.to)

        if (v === 8) return stored as FilterState

        if (v >= 2 && v <= 7) {
          return {
            ...defaults,
            ...stored,
            version: 8,
            sources: v === 3 ? [] : (stored.sources ?? defaults.sources),
            dateRange: hasExplicitDateRange ? storedDateRange : defaults.dateRange,
            // Deliberately dropped, not carried forward. Through v7 this field
            // only filtered a list; from v8 it also decides where messages are
            // sent. Promoting a browse selection somebody made months ago into
            // a send target — silently, on upgrade — is exactly the failure
            // this store version exists to prevent. One reset, then the user
            // picks again with the new meaning in force.
            profile: defaults.profile,
          }
        }
        return defaults
      },
      version: 8,
    },
  ),
)

// ── Device layer of the profile resolver ────────────────────────────────────
//
// `profile` is published to `lib/session-scope.ts` rather than read out of this
// store by the surfaces that need it. One writer (this subscription), one
// reader (the resolver), so nothing downstream has to know that a profile can
// come from two places, and no second copy of the value exists to drift.
//
// No-ops on the server (`setDeviceSessionProfile` is client-only), and the gate
// in `syncSessionProfileToPath` still decides whether the published value
// applies to the current route.

function publishDeviceProfile(profile: string): void {
  setDeviceSessionProfile(profile)
}

publishDeviceProfile(useSessionsFilterStore.getState().profile)

useSessionsFilterStore.subscribe((state, previous) => {
  // Also fires on rehydration, which is how a persisted selection reaches the
  // resolver before the first request goes out.
  if (state.profile !== previous.profile) publishDeviceProfile(state.profile)
})
