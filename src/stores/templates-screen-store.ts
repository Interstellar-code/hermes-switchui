/**
 * templates-screen-store.ts — local UI state for the Board Templates screen.
 * Mirrors profiles-screen-store but in the boards vocabulary ('grid' | 'list').
 * Persisted to localStorage under `switchui-templates-view`.
 * `page` is kept as local component state in the screen (reset to 1 on search).
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TemplatesViewMode = 'grid' | 'list'

export const PAGE_SIZES_GRID = [12, 24, 48] as const
export const PAGE_SIZES_LIST = [25, 50, 100] as const
export const DEFAULT_PAGE_SIZE_GRID = 12
export const DEFAULT_PAGE_SIZE_LIST = 25

type TemplatesViewState = {
  viewMode: TemplatesViewMode
  pageSizeGrid: number
  pageSizeList: number
  setViewMode: (m: TemplatesViewMode) => void
  setPageSize: (n: number) => void
}

// Persisted slice — view mode + page sizes per view
export const useTemplatesViewStore = create<TemplatesViewState>()(
  persist(
    (set) => ({
      viewMode: 'list' as TemplatesViewMode,
      pageSizeGrid: DEFAULT_PAGE_SIZE_GRID,
      pageSizeList: DEFAULT_PAGE_SIZE_LIST,
      setViewMode: (viewMode) => set({ viewMode }),
      setPageSize: (n) =>
        set((s) => (s.viewMode === 'grid' ? { pageSizeGrid: n } : { pageSizeList: n })),
    }),
    { name: 'switchui-templates-view' },
  ),
)

// Derived selector — current page size based on active view
export function usePageSize(): number {
  const { viewMode, pageSizeGrid, pageSizeList } = useTemplatesViewStore()
  return viewMode === 'grid' ? pageSizeGrid : pageSizeList
}
