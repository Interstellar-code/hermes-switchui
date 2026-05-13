/**
 * conductor-ui-store.ts — M5 UI state for the Conductor screen.
 *
 * Session-only except goalDraft which persists to localStorage.
 * localStorage key: `conductor:goal-draft`
 */

import { create } from 'zustand'

export type CanvasView = 'flow' | 'org'
export type LaneScale = '1M' | '5M' | '15M' | '1H'
export type FilterTab = 'all' | 'live' | 'done' | 'err'

type ConductorUIState = {
  canvasView: CanvasView
  laneScale: LaneScale
  filterTab: FilterTab
  focusedMissionId: string | null
  newMissionDialogOpen: boolean
  goalDraft: string
}

type ConductorUIActions = {
  setCanvasView: (view: CanvasView) => void
  setLaneScale: (scale: LaneScale) => void
  setFilterTab: (tab: FilterTab) => void
  setFocusedMissionId: (id: string | null) => void
  openNewMissionDialog: () => void
  closeNewMissionDialog: () => void
  setGoalDraft: (draft: string) => void
}

const GOAL_DRAFT_KEY = 'conductor:goal-draft'

function loadGoalDraft(): string {
  try {
    return localStorage.getItem(GOAL_DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveGoalDraft(draft: string): void {
  try {
    localStorage.setItem(GOAL_DRAFT_KEY, draft)
  } catch {
    // ignore
  }
}

export const useConductorUIStore = create<ConductorUIState & ConductorUIActions>()((set) => ({
  canvasView: 'flow',
  laneScale: '5M',
  filterTab: 'all',
  focusedMissionId: null,
  newMissionDialogOpen: false,
  goalDraft: loadGoalDraft(),

  setCanvasView: (canvasView) => set({ canvasView }),
  setLaneScale: (laneScale) => set({ laneScale }),
  setFilterTab: (filterTab) => set({ filterTab }),
  setFocusedMissionId: (focusedMissionId) => set({ focusedMissionId }),
  openNewMissionDialog: () => set({ newMissionDialogOpen: true }),
  closeNewMissionDialog: () => set({ newMissionDialogOpen: false }),
  setGoalDraft: (goalDraft) => {
    saveGoalDraft(goalDraft)
    set({ goalDraft })
  },
}))
