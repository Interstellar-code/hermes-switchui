/**
 * sessions-filter-store.ts — Phase 2 of the Sessions Sidebar plan.
 *
 * Persisted filter state for the unified sessions sidebar.
 * localStorage key: `hermes.sessions.filter`
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  SessionDateRange,
  SessionFeedSort,
  SessionSource,
  SessionState,
} from '@/screens/chat/sessions-feed-types'
import { UNSCOPED_PROFILE, setDeviceSessionProfile } from '@/lib/session-scope'
import { clampSidebarWidth } from '@/screens/chat/components/sidebar/v2/sidebar-resize-handle-v2'

export { UNSCOPED_PROFILE }

export type FilterState = {
  version: 9
  /**
   * Sources to HIDE. A selected source chip excludes that source from the
   * list; empty array = nothing hidden = everything shows.
   */
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
  /**
   * Sidebar grouping. Added without a version bump: persist's shallow merge
   * fills it with the initial `'date'` on existing v9 payloads.
   */
  groupBy: 'date' | 'project'
  /** Expanded sessions panel width in px. Added without a version bump. */
  sidebarWidth: number
}

type FilterActions = {
  toggleSource: (src: SessionSource) => void
  clearSources: () => void
  setState: (s: SessionState | 'all') => void
  setQuery: (q: string) => void
  setDateRange: (from: string | null, to: string | null) => void
  setSort: (s: SessionFeedSort) => void
  toggleUpdatesOnly: () => void
  setCollapsed: (b: boolean) => void
  setLeftPanel: (p: 'sessions' | 'files') => void
  setProfile: (p: string) => void
  setGroupBy: (g: 'date' | 'project') => void
  setSidebarWidth: (w: number) => void
  reset: () => void
}

/**
 * No window by default.
 *
 * This used to return a rolling 7-day range. Persisted, that range froze at the
 * date of first load — `migrate` returns a same-version payload verbatim — so
 * weeks later the sidebar was silently clipped to a dead window nobody picked.
 * Chip counts went to zero and toggling a source looked like a no-op. A filter
 * the user never chose must not hide their sessions; the date popover still
 * offers 7d for anyone who wants it.
 */
export function buildDefaultDateRange(): SessionDateRange {
  return { from: null, to: null }
}

function buildInitialState(): FilterState {
  return {
    version: 9,
    sources: [],
    state: 'all',
    query: '',
    dateRange: buildDefaultDateRange(),
    sort: 'recent',
    updatesOnly: false,
    collapsed: false,
    leftPanel: 'sessions',
    profile: UNSCOPED_PROFILE,
    groupBy: 'date',
    sidebarWidth: 320,
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

      clearSources: () => set({ sources: [] }),

      setState: (state) => set({ state }),

      setQuery: (query) => set({ query }),

      setDateRange: (from, to) => set({ dateRange: { from, to } }),

      setSort: (sort) => set({ sort }),

      toggleUpdatesOnly: () =>
        set((state) => ({ updatesOnly: !state.updatesOnly })),

      setCollapsed: (collapsed) => set({ collapsed }),

      setLeftPanel: (leftPanel) => set({ leftPanel }),

      setProfile: (profile) => set({ profile }),

      setGroupBy: (groupBy) => set({ groupBy }),

      setSidebarWidth: (sidebarWidth) => {
        if (Number.isFinite(sidebarWidth))
          set({ sidebarWidth: clampSidebarWidth(sidebarWidth) })
      },

      reset: () => set(buildInitialState()),
    }),
    {
      name: 'hermes.sessions.filter',
      migrate: (persisted, _version) => {
        const stored = (persisted ?? {}) as Partial<FilterState> & {
          version?: number
        }
        const v = Number(stored.version) || 0
        const defaults = buildInitialState()
        if (v === 9) return stored as FilterState

        if (v >= 2 && v <= 8) {
          return {
            ...defaults,
            ...stored,
            version: 9,
            sources: v === 3 ? [] : (stored.sources ?? defaults.sources),
            // Dropped, not carried forward. Every v<=8 payload has a concrete
            // date window in it, and there is no way to tell one the user chose
            // from the rolling 7-day default that froze on the day they first
            // loaded the app. A stale window silently empties the sidebar, so
            // the safe read of an ambiguous value is "no window".
            dateRange: defaults.dateRange,
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
      version: 9,
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
