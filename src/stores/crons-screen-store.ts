/**
 * crons-screen-store.ts — local UI state for the Crons screen (P1).
 * Persisted to localStorage under `switchui-crons-view` / `switchui-crons-page-size`.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CronsViewMode = 'grid' | 'table'

type CronsPersistedState = {
  viewMode: CronsViewMode
  pageSizeGrid: number
  pageSizeTable: number
}

type CronsEphemeralState = {
  search: string
  statusFilter: 'all' | 'active' | 'paused' | 'error' | 'idle'
  cadenceFilter: 'all' | 'hourly' | 'daily' | 'weekly' | 'custom'
  page: number
}

type CronsActions = {
  setViewMode: (m: CronsViewMode) => void
  setPageSize: (n: number) => void
  setSearch: (q: string) => void
  setStatusFilter: (s: CronsEphemeralState['statusFilter']) => void
  setCadenceFilter: (c: CronsEphemeralState['cadenceFilter']) => void
  setPage: (p: number) => void
  resetFilters: () => void
}

const defaultEphemeral: CronsEphemeralState = {
  search: '',
  statusFilter: 'all',
  cadenceFilter: 'all',
  page: 1,
}

export const PAGE_SIZES_GRID = [12, 24, 48] as const
export const PAGE_SIZES_TABLE = [25, 50, 100] as const
export const DEFAULT_PAGE_SIZE_GRID = 24
export const DEFAULT_PAGE_SIZE_TABLE = 50

// Persisted slice — view mode + page sizes
export const useCronsViewStore = create<
  CronsPersistedState & Pick<CronsActions, 'setViewMode' | 'setPageSize'>
>()(
  persist(
    (set, get) => ({
      viewMode: 'grid' as CronsViewMode,
      pageSizeGrid: DEFAULT_PAGE_SIZE_GRID,
      pageSizeTable: DEFAULT_PAGE_SIZE_TABLE,
      setViewMode: (m) => set({ viewMode: m }),
      setPageSize: (n) => {
        const { viewMode } = get()
        if (viewMode === 'grid') set({ pageSizeGrid: n })
        else set({ pageSizeTable: n })
      },
    }),
    { name: 'switchui-crons-view' },
  ),
)

// Ephemeral slice — filters / search / page (no persist)
export const useCronsFilterStore = create<CronsEphemeralState & CronsActions>()(
  (set) => ({
    ...defaultEphemeral,
    setViewMode: () => {},
    setPageSize: () => {},
    setSearch: (q) => set({ search: q, page: 1 }),
    setStatusFilter: (s) => set({ statusFilter: s, page: 1 }),
    setCadenceFilter: (c) => set({ cadenceFilter: c, page: 1 }),
    setPage: (p) => set({ page: p }),
    resetFilters: () => set(defaultEphemeral),
  }),
)

export function useCronsPageSize(): number {
  const { viewMode, pageSizeGrid, pageSizeTable } = useCronsViewStore()
  return viewMode === 'grid' ? pageSizeGrid : pageSizeTable
}
