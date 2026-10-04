import { create } from 'zustand'

/**
 * "New chat in this folder": the folder a not-yet-created chat (`/chat/new`)
 * should be filed in once its first send creates the real session. Not
 * persisted — a reload or leaving the new chat drops the intent.
 */
export type PendingFolder = {
  projectId: string
  projectSlug: string
  name: string
  /** Browsed profile when the intent was recorded (null = unscoped). */
  profile: string | null
}

export const usePendingFolderStore = create<{
  pending: PendingFolder | null
  set: (pending: PendingFolder) => void
  clear: () => void
}>((set) => ({
  pending: null,
  set: (pending) => set({ pending }),
  clear: () => set({ pending: null }),
}))
