/**
 * Workflow backend selection — persisted to localStorage.
 *
 * 'native'  — use the built-in SwitchUiWorkflowStore (default).
 * 'plugin'  — delegate all workflow calls to the Python workflow-engine plugin.
 *
 * The selected value is injected as the X-Workflow-Backend header on all
 * workflow-related API fetches via the fetch interceptor in src/lib/api-client.ts.
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
      backend: 'native',
      setBackend: (backend) => set({ backend }),
      toggleBackend: () =>
        set({ backend: get().backend === 'native' ? 'plugin' : 'native' }),
    }),
    {
      name: 'workflowBackend',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ backend: state.backend }),
    },
  ),
)
