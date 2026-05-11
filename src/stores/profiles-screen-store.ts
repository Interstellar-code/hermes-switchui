/**
 * profiles-screen-store.ts — local UI state for the Profiles screen (P2).
 * Persisted to localStorage under `switchui-profiles-view` / `switchui-profiles-page-size`.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ProfilesViewMode = 'grid' | 'table'

type ProfilesPersistedState = {
  viewMode: ProfilesViewMode
  pageSizeGrid: number
  pageSizeTable: number
}

type ProfilesEphemeralState = {
  search: string
  tierFilter: 'all' | '1' | '2' | '3'
  statusFilter: 'all' | 'active' | 'idle' | 'draft'
  modelFilter: string
  tagFilter: string
  page: number
}

type ProfilesActions = {
  setViewMode: (m: ProfilesViewMode) => void
  setPageSize: (n: number) => void
  setSearch: (q: string) => void
  setTierFilter: (t: ProfilesEphemeralState['tierFilter']) => void
  setStatusFilter: (s: ProfilesEphemeralState['statusFilter']) => void
  setModelFilter: (m: string) => void
  setTagFilter: (tag: string) => void
  setPage: (p: number) => void
  resetFilters: () => void
}

const defaultEphemeral: ProfilesEphemeralState = {
  search: '',
  tierFilter: 'all',
  statusFilter: 'all',
  modelFilter: 'all',
  tagFilter: 'all',
  page: 1,
}

export const PAGE_SIZES_GRID = [12, 24, 48, 96] as const
export const PAGE_SIZES_TABLE = [25, 50, 100, 200] as const
export const DEFAULT_PAGE_SIZE_GRID = 24
export const DEFAULT_PAGE_SIZE_TABLE = 50

// Persisted slice — view mode + page sizes per view
export const useProfilesViewStore = create<
  ProfilesPersistedState & Pick<ProfilesActions, 'setViewMode' | 'setPageSize'>
>()(
  persist(
    (set) => ({
      viewMode: 'grid' as ProfilesViewMode,
      pageSizeGrid: DEFAULT_PAGE_SIZE_GRID,
      pageSizeTable: DEFAULT_PAGE_SIZE_TABLE,
      setViewMode: (viewMode) => set({ viewMode }),
      setPageSize: (n) =>
        set((s) =>
          s.viewMode === 'grid' ? { pageSizeGrid: n } : { pageSizeTable: n },
        ),
    }),
    { name: 'switchui-profiles-view' },
  ),
)

// Derived selector — current page size based on active view
export function usePageSize(): number {
  const { viewMode, pageSizeGrid, pageSizeTable } = useProfilesViewStore()
  return viewMode === 'grid' ? pageSizeGrid : pageSizeTable
}

// Ephemeral slice — filters + page (not persisted)
export const useProfilesFilterStore = create<
  ProfilesEphemeralState & Omit<ProfilesActions, 'setViewMode' | 'setPageSize'>
>()((set) => ({
  ...defaultEphemeral,

  setSearch: (search) => set({ search, page: 1 }),
  setTierFilter: (tierFilter) => set({ tierFilter, page: 1 }),
  setStatusFilter: (statusFilter) => set({ statusFilter, page: 1 }),
  setModelFilter: (modelFilter) => set({ modelFilter, page: 1 }),
  setTagFilter: (tagFilter) => set({ tagFilter, page: 1 }),
  setPage: (page) => set({ page }),
  resetFilters: () => set(defaultEphemeral),
}))
