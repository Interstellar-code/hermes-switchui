/**
 * Workflow backend selection — persisted to localStorage.
 *
 * Phase 2: default changed to 'plugin'. Rehydration migration upgrades any
 * stored 'native' value to 'plugin' so existing sessions are migrated on
 * next load. Phase 3 will delete this store and the toggle component.
 *
 * 'plugin'  — delegate all workflow calls to the Python workflow-engine plugin.
 * 'native'  — legacy; kept as valid type for Phase 3 deletion.
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type WorkflowBackend = 'native' | 'plugin'

type State = {
  backend: WorkflowBackend
}

type Actions = {
  setBackend: (backend: WorkflowBackend) => void
  toggleBackend: () => void
}

export const useWorkflowBackendStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      backend: 'plugin',
      setBackend: (backend) => set({ backend }),
      toggleBackend: () =>
        set({ backend: get().backend === 'native' ? 'plugin' : 'native' }),
    }),
    {
      name: 'workflowBackend',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ backend: state.backend }),
      onRehydrateStorage: () => (state) => {
        // Migrate stored 'native' → 'plugin' (Phase 2 cutover).
        if (state && state.backend === 'native') {
          state.backend = 'plugin'
        }
      },
    },
  ),
)
