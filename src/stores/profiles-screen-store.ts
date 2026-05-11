/**
 * profiles-screen-store.ts — local UI state for the Profiles screen (P2).
 * Persisted to localStorage under `switchui-profiles-view` / `switchui-profiles-page-size`.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ProfilesViewMode = 'grid' | 'table'

type ProfilesPersistedState = {
  viewMode: ProfilesViewMode
  pageSize: number
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

// Persisted slice — view mode + page size
export const useProfilesViewStore = create<
  ProfilesPersistedState & Pick<ProfilesActions, 'setViewMode' | 'setPageSize'>
>()(
  persist(
    (set) => ({
      viewMode: 'grid',
      pageSize: 25,
      setViewMode: (viewMode) => set({ viewMode }),
      setPageSize: (pageSize) => set({ pageSize }),
    }),
    { name: 'switchui-profiles-view' },
  ),
)

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
