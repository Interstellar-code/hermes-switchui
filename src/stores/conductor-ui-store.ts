/**
 * conductor-ui-store.ts — UI state for the Conductor screen (session-only).
 *
 * selectedRunId = what the canvas shows; drawerRunId = what the inspector shows.
 */

import { create } from 'zustand'
import type { InspectTab } from '@/screens/workflows/run-inspector/inspector-model'

export type CanvasView = 'flow' | 'org'
export type LaneScale = '1M' | '5M' | '15M' | '1H'
export type FilterTab = 'all' | 'live' | 'waiting' | 'done' | 'err'

type ConductorUIState = {
  canvasView: CanvasView
  laneScale: LaneScale
  filterTab: FilterTab
  selectedRunId: string | null
  drawerRunId: string | null
  inspectTab: InspectTab
  /** Node row expanded in the inspector's NODE RUNS tab. */
  expandedNodeId: string | null
}

type ConductorUIActions = {
  setCanvasView: (view: CanvasView) => void
  setLaneScale: (scale: LaneScale) => void
  setFilterTab: (tab: FilterTab) => void
  setSelectedRunId: (id: string | null) => void
  setDrawerRunId: (id: string | null) => void
  /** Open (or switch) the inspector with tab / expanded row in one update. */
  openInspector: (
    runId: string,
    opts?: { tab?: InspectTab; expandedNodeId?: string | null },
  ) => void
  setInspectTab: (tab: InspectTab) => void
  setExpandedNodeId: (id: string | null) => void
}

export const useConductorUIStore = create<
  ConductorUIState & ConductorUIActions
>()((set) => ({
  canvasView: 'flow',
  laneScale: '5M',
  filterTab: 'all',
  selectedRunId: null,
  drawerRunId: null,
  inspectTab: 'overview',
  expandedNodeId: null,

  setCanvasView: (canvasView) => set({ canvasView }),
  setLaneScale: (laneScale) => set({ laneScale }),
  setFilterTab: (filterTab) => set({ filterTab }),
  setSelectedRunId: (selectedRunId) => set({ selectedRunId }),
  // Same run: no-op. Otherwise the expanded row clears; the tab resets to
  // Overview only when opening from closed (switching run keeps the tab).
  setDrawerRunId: (drawerRunId) =>
    set((s) =>
      drawerRunId === s.drawerRunId
        ? {}
        : {
            drawerRunId,
            expandedNodeId: null,
            ...(s.drawerRunId == null
              ? { inspectTab: 'overview' as const }
              : {}),
          },
    ),
  // Given opts win; whatever is not given follows setDrawerRunId's rules.
  openInspector: (drawerRunId, opts = {}) =>
    set((s) => {
      const same = drawerRunId === s.drawerRunId
      return {
        drawerRunId,
        inspectTab:
          opts.tab ?? (s.drawerRunId == null ? 'overview' : s.inspectTab),
        expandedNodeId:
          opts.expandedNodeId !== undefined
            ? opts.expandedNodeId
            : same
              ? s.expandedNodeId
              : null,
      }
    }),
  setInspectTab: (inspectTab) => set({ inspectTab }),
  setExpandedNodeId: (expandedNodeId) => set({ expandedNodeId }),
}))
