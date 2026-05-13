/**
 * operations-ui-store.ts — M5 UI state for the Operations screen.
 *
 * Session-only except dispatchDraft which persists to localStorage.
 * localStorage key: `operations:dispatch-draft`
 */

import { create } from 'zustand'
import { AGENTS } from '../screens/agents/operations/mock-data'

export type TeamFilter = 'all' | 'live' | 'idle' | 'issues'
export type OutputsFilter = 'all' | 'code' | 'docs' | 'data' | 'media'
export type DispatchMode = 'auto' | 'broadcast' | 'manual'

type OperationsUIState = {
  teamFilter: TeamFilter
  outputsFilter: OutputsFilter
  dispatchMode: DispatchMode
  focusedAgentId: string | null
  dispatchDraft: string
  autoRefresh: boolean
  newAgentModalOpen: boolean
}

type OperationsUIActions = {
  setTeamFilter: (filter: TeamFilter) => void
  setOutputsFilter: (filter: OutputsFilter) => void
  setDispatchMode: (mode: DispatchMode) => void
  setFocusedAgentId: (id: string | null) => void
  setDispatchDraft: (draft: string) => void
  setAutoRefresh: (on: boolean) => void
  setNewAgentModalOpen: (open: boolean) => void
}

const DISPATCH_DRAFT_KEY = 'operations:dispatch-draft'

function loadDispatchDraft(): string {
  try {
    return localStorage.getItem(DISPATCH_DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveDispatchDraft(draft: string): void {
  try {
    localStorage.setItem(DISPATCH_DRAFT_KEY, draft)
  } catch {
    // ignore
  }
}

const firstAgentId = AGENTS[0]?.id ?? null

export const useOperationsUIStore = create<OperationsUIState & OperationsUIActions>()((set) => ({
  teamFilter: 'all',
  outputsFilter: 'all',
  dispatchMode: 'auto',
  focusedAgentId: firstAgentId,
  dispatchDraft: loadDispatchDraft(),
  autoRefresh: true,
  newAgentModalOpen: false,

  setTeamFilter: (teamFilter) => set({ teamFilter }),
  setOutputsFilter: (outputsFilter) => set({ outputsFilter }),
  setDispatchMode: (dispatchMode) => set({ dispatchMode }),
  setFocusedAgentId: (focusedAgentId) => set({ focusedAgentId }),
  setDispatchDraft: (dispatchDraft) => {
    saveDispatchDraft(dispatchDraft)
    set({ dispatchDraft })
  },
  setAutoRefresh: (autoRefresh) => set({ autoRefresh }),
  setNewAgentModalOpen: (newAgentModalOpen) => set({ newAgentModalOpen }),
}))
