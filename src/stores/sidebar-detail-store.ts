/**
 * sidebar-detail-store.ts — Zustand store for the v2 sidebar detail drawer.
 *
 * Tracks which item is open in the right-anchored detail drawer.
 * Consumers: sidebar-card-v2.tsx (open), sidebar-detail-drawer-v2.tsx (read/close).
 */
import { create } from 'zustand'

export type DetailKind = 'task' | 'mem' | 'cron-run'

export type DetailDrawerState = {
  open: { kind: DetailKind; id: string } | null
}

export type DetailDrawerActions = {
  openDrawer: (kind: DetailKind, id: string) => void
  closeDrawer: () => void
}

export const useSidebarDetailStore = create<DetailDrawerState & DetailDrawerActions>((set) => ({
  open: null,
  openDrawer: (kind, id) => set({ open: { kind, id } }),
  closeDrawer: () => set({ open: null }),
}))
