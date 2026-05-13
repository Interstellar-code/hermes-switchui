import { create } from 'zustand'

/**
 * matrix3d-store.ts — Zustand store for Matrix3D agent detail panel.
 *
 * Tracks which agent is selected and the panel open/close state.
 * Pattern matches sidebar-detail-store.ts.
 */

export type Matrix3DPanelState = {
  /** Selected agent ID (session key), or null if panel is closed */
  selectedAgentId: string | null
}

export type Matrix3DPanelActions = {
  selectAgent: (id: string) => void
  deselectAgent: () => void
}

export const useMatrix3DStore = create<Matrix3DPanelState & Matrix3DPanelActions>((set) => ({
  selectedAgentId: null,
  selectAgent: (id) => set({ selectedAgentId: id }),
  deselectAgent: () => set({ selectedAgentId: null }),
}))
