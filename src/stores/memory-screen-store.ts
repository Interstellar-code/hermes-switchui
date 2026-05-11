/**
 * memory-screen-store.ts — local UI state for the Memory screen (P3).
 * Active tab persisted to localStorage under `switchui-memory-screen`.
 * Selected agent is ephemeral (resets on nav).
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type MemoryTab = 'memory' | 'wiki' | 'graph' | 'settings' | 'chat'

type MemoryPersistedState = {
  activeTab: MemoryTab
}

type MemoryEphemeralState = {
  selectedAgentId: string
}

type MemoryActions = {
  setActiveTab: (tab: MemoryTab) => void
  setSelectedAgentId: (id: string) => void
}

// Persisted slice — active tab survives navigation
export const useMemoryScreenStore = create<
  MemoryPersistedState & Pick<MemoryActions, 'setActiveTab'>
>()(
  persist(
    (set) => ({
      activeTab: 'memory' as MemoryTab,
      setActiveTab: (activeTab) => set({ activeTab }),
    }),
    { name: 'switchui-memory-screen' },
  ),
)

// Ephemeral slice — selected agent resets on unmount
export const useMemoryAgentStore = create<
  MemoryEphemeralState & Pick<MemoryActions, 'setSelectedAgentId'>
>()((set) => ({
  selectedAgentId: 'hermes-switch',
  setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),
}))
