/**
 * memory-screen-store.ts — local UI state for the Memory screen (P3).
 * Active tab + selected profile persisted to localStorage under
 * `switchui-memory-screen`.
 * Selected agent is ephemeral (resets on nav).
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type MemoryTab = 'memory' | 'browse' | 'wiki' | 'map' | 'settings' | 'chat'

const VALID_TABS: ReadonlyArray<MemoryTab> = [
  'memory',
  'browse',
  'wiki',
  'map',
  'settings',
  'chat',
]

/** Mirrors DEFAULT_MEMORY_PROFILE in src/server/memory-profile.ts. */
export const DEFAULT_MEMORY_PROFILE = 'hermes-switch'

type MemoryPersistedState = {
  activeTab: MemoryTab
  /** Hermes profile the whole /memory page reads. */
  profile: string
}

type MemoryEphemeralState = {
  selectedAgentId: string
}

type MemoryActions = {
  setActiveTab: (tab: MemoryTab) => void
  setProfile: (profile: string) => void
  setSelectedAgentId: (id: string) => void
}

// Persisted slice — active tab survives navigation
export const useMemoryScreenStore = create<
  MemoryPersistedState & Pick<MemoryActions, 'setActiveTab' | 'setProfile'>
>()(
  persist(
    (set) => ({
      activeTab: 'memory',
      profile: DEFAULT_MEMORY_PROFILE,
      setActiveTab: (activeTab) => set({ activeTab }),
      setProfile: (profile) => set({ profile }),
    }),
    {
      name: 'switchui-memory-screen',
      version: 2,
      // v1 had a 'graph' tab (Wiki Graph). v2 replaces it with 'map' (Memory
      // Map, issue #342). Migrate 'graph' → 'map'; any unknown value → 'memory'.
      migrate: (persisted) => {
        const prev = (persisted as Partial<MemoryPersistedState> | undefined)
          ?.activeTab as MemoryTab | 'graph' | undefined
        let tab: MemoryTab
        if (prev === 'graph') tab = 'map'
        else if (prev && VALID_TABS.includes(prev)) tab = prev
        else tab = 'memory'
        return { activeTab: tab, profile: DEFAULT_MEMORY_PROFILE }
      },
    },
  ),
)

// Ephemeral slice — selected agent resets on unmount
export const useMemoryAgentStore = create<
  MemoryEphemeralState & Pick<MemoryActions, 'setSelectedAgentId'>
>()((set) => ({
  selectedAgentId: 'hermes-switch',
  setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),
}))

// One-shot hand-off of a Browse filter (e.g. a chat source "matrix-memory:gist")
// to the Browse tab, which reads it as its initial filter. Mirrors wiki-focus-store.
export type BrowseFocus = { type: string | null; q: string }

export const useBrowseFocusStore = create<{
  focus: BrowseFocus | null
  setFocus: (focus: BrowseFocus | null) => void
}>()((set) => ({
  focus: null,
  setFocus: (focus) => set({ focus }),
}))
