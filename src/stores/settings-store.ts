/**
 * settings-store.ts — Zustand store for Settings screen draft/committed state.
 * Tracks dirty keys, supports per-key discard, and exposes save/reset actions.
 */

import { create } from 'zustand'

type SaverFn = (patch: Record<string, unknown>) => Promise<void>

type SettingsState = {
  loaded: boolean
  committed: Record<string, unknown>
  draft: Record<string, unknown>
  dirty: Set<string>
}

type SettingsActions = {
  /** Populate store from server snapshot */
  load: (committed: Record<string, unknown>) => void
  /** Update a single key in draft */
  set: (key: string, value: unknown) => void
  /** Persist dirty keys via the provided saver fn */
  save: (saver: SaverFn) => Promise<void>
  /** Revert draft to committed snapshot */
  reset: () => void
  /** Revert a single key to its committed value */
  discard: (key: string) => void
}

export type SettingsStore = SettingsState & SettingsActions

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  loaded: false,
  committed: {},
  draft: {},
  dirty: new Set<string>(),

  load(committed) {
    set({
      loaded: true,
      committed,
      draft: { ...committed },
      dirty: new Set<string>(),
    })
  },

  set(key, value) {
    const { committed, draft, dirty } = get()
    const newDraft = { ...draft, [key]: value }
    const newDirty = new Set(dirty)
    // Mark dirty only when value differs from committed
    if (committed[key] !== value) {
      newDirty.add(key)
    } else {
      newDirty.delete(key)
    }
    set({ draft: newDraft, dirty: newDirty })
  },

  async save(saver) {
    const { draft, dirty, committed } = get()
    if (dirty.size === 0) return
    const patch: Record<string, unknown> = {}
    dirty.forEach((k) => {
      patch[k] = draft[k]
    })
    await saver(patch)
    // On success: committed = draft, dirty cleared
    set({
      committed: { ...committed, ...patch },
      dirty: new Set<string>(),
    })
  },

  reset() {
    const { committed } = get()
    set({
      draft: { ...committed },
      dirty: new Set<string>(),
    })
  },

  discard(key) {
    const { committed, draft, dirty } = get()
    const newDraft = { ...draft, [key]: committed[key] }
    const newDirty = new Set(dirty)
    newDirty.delete(key)
    set({ draft: newDraft, dirty: newDirty })
  },
}))

// ── Selectors ─────────────────────────────────────────────────────────────

/** Returns [draftValue, setter] for a single config key */
export function useSetting(key: string): [unknown, (v: unknown) => void] {
  const value = useSettingsStore((s) => s.draft[key])
  const setter = useSettingsStore((s) => s.set)
  return [value, (v) => setter(key, v)]
}

/** Returns count of dirty keys */
export function useDirtyCount(): number {
  return useSettingsStore((s) => s.dirty.size)
}
