/**
 * conductor-layout-store.ts — dragged Conductor canvas positions and the
 * lock toggle, persisted per workflowId. Definition changes are absorbed by
 * mergePositions (flow-model.ts), so the key is the workflow id only.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface SavedLayout {
  positions: Record<string, { x: number; y: number }>
  locked: boolean
  at: number
}

export const LAYOUT_CAP = 50

interface LayoutState {
  layouts: Record<string, SavedLayout>
  savePositions: (
    workflowId: string,
    positions: SavedLayout['positions'],
  ) => void
  setLocked: (workflowId: string, locked: boolean) => void
  /** Drops saved positions (RESET LAYOUT); keeps the lock. */
  resetLayout: (workflowId: string) => void
}

/** Upsert one entry and keep only the newest LAYOUT_CAP by `at`. */
function upsert(
  layouts: Record<string, SavedLayout>,
  workflowId: string,
  patch: Partial<SavedLayout>,
): Record<string, SavedLayout> {
  const prev = layouts[workflowId] as SavedLayout | undefined
  const next = {
    ...layouts,
    [workflowId]: {
      positions: prev?.positions ?? {},
      locked: prev?.locked ?? false,
      ...patch,
      at: Date.now(),
    },
  }
  const keep = Object.entries(next)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, LAYOUT_CAP)
  return Object.fromEntries(keep)
}

export const useConductorLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      layouts: {},
      savePositions: (workflowId, positions) =>
        set((s) => ({ layouts: upsert(s.layouts, workflowId, { positions }) })),
      setLocked: (workflowId, locked) =>
        set((s) => ({ layouts: upsert(s.layouts, workflowId, { locked }) })),
      resetLayout: (workflowId) =>
        set((s) =>
          workflowId in s.layouts
            ? { layouts: upsert(s.layouts, workflowId, { positions: {} }) }
            : s,
        ),
    }),
    {
      name: 'switchui-conductor-layout',
      version: 1,
      partialize: (s) => ({ layouts: s.layouts }),
      migrate: (persisted, fromVersion) =>
        fromVersion === 1
          ? (persisted as { layouts: Record<string, SavedLayout> })
          : { layouts: {} },
    },
  ),
)
