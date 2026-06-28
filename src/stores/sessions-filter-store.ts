/**
 * sessions-filter-store.ts — Phase 2 of the Sessions Sidebar plan.
 *
 * Persisted filter state for the unified sessions sidebar.
 * localStorage key: `hermes.sessions.filter`
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SessionDateRange, SessionFeedSort, SessionSource, SessionState } from '@/screens/chat/sessions-feed-types'

export type FilterState = {
  version: 5
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
  /** Sidebar collapsed state. */
  collapsed: boolean
  /** Which panel renders in the left column: sessions list or file explorer. */
  leftPanel: 'sessions' | 'files'
}

type FilterActions = {
  toggleSource: (src: SessionSource) => void
  setState: (s: SessionState | 'all') => void
  setQuery: (q: string) => void
  setDateRange: (from: string | null, to: string | null) => void
  setSort: (s: SessionFeedSort) => void
  setCollapsed: (b: boolean) => void
  setLeftPanel: (p: 'sessions' | 'files') => void
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
    version: 5,
    sources: [],
    state: 'all',
    query: '',
    dateRange: buildDefaultDateRange(),
    sort: 'recent',
    collapsed: false,
    leftPanel: 'sessions',
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

      setCollapsed: (collapsed) => set({ collapsed }),

      setLeftPanel: (leftPanel) => set({ leftPanel }),

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

        if (v === 5) return stored as FilterState

        if (v === 2 || v === 3 || v === 4) {
          return {
            ...defaults,
            ...stored,
            version: 5,
            sources: v === 3 ? [] : (stored.sources ?? defaults.sources),
            dateRange: hasExplicitDateRange ? storedDateRange : defaults.dateRange,
          }
        }
        return defaults
      },
      version: 5,
    },
  ),
)
