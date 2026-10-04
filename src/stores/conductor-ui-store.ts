/**
 * conductor-ui-store.ts — UI state for the Conductor screen (session-only).
 *
 * selectedRunId = what the canvas shows; drawerRunId = what the inspector shows.
 */

import { create } from 'zustand'

export type CanvasView = 'flow' | 'org'
export type LaneScale = '1M' | '5M' | '15M' | '1H'
export type FilterTab = 'all' | 'live' | 'waiting' | 'done' | 'err'

type ConductorUIState = {
  canvasView: CanvasView
  laneScale: LaneScale
  filterTab: FilterTab
  selectedRunId: string | null
  drawerRunId: string | null
}

type ConductorUIActions = {
  setCanvasView: (view: CanvasView) => void
  setLaneScale: (scale: LaneScale) => void
  setFilterTab: (tab: FilterTab) => void
  setSelectedRunId: (id: string | null) => void
  setDrawerRunId: (id: string | null) => void
}

export const useConductorUIStore = create<ConductorUIState & ConductorUIActions>()((set) => ({
  canvasView: 'flow',
  laneScale: '5M',
  filterTab: 'all',
  selectedRunId: null,
  drawerRunId: null,

  setCanvasView: (canvasView) => set({ canvasView }),
  setLaneScale: (laneScale) => set({ laneScale }),
  setFilterTab: (filterTab) => set({ filterTab }),
  setSelectedRunId: (selectedRunId) => set({ selectedRunId }),
  setDrawerRunId: (drawerRunId) => set({ drawerRunId }),
}))
