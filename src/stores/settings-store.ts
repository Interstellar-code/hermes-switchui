/**
 * settings-store.ts — draft/committed state for the Settings screen.
 *
 * ## Invariants
 *
 * 1. `draft` is **dense and resolved**: `{ ...defaults, ...committed, ...overlay }`.
 *    Roughly 200 call sites read `draft['config.x']` directly and expect a
 *    value, not `undefined`, so the overlay is never exposed as `draft`.
 * 2. `overlay` holds exactly the user's unsaved edits, and its key set is
 *    always identical to `dirty`. Nothing else may write it.
 * 3. `committed` is server truth and nothing else. Fabricated fallbacks live
 *    in `defaults` so Export keeps exporting what the server actually has.
 * 4. Only `seed()` may write `status`. `registerDefaults()` in particular may
 *    never write `status`, `committed` or `dirty` — a mount effect that did
 *    exactly that (via the old `load()`) is what raced the real server seed
 *    and silently discarded other sections' edits.
 * 5. `save()` never throws and commits **only** the keys the saver reports as
 *    persisted.
 */

import { create } from 'zustand'
import { valuesEqual } from './settings-equal'
import type { SaveFailure, SaveOutcome } from '@/screens/settings/lib/saver'

export type SettingsSaverFn = (
  patch: Record<string, unknown>,
) => Promise<SaveOutcome>

export type SavePhase = 'idle' | 'saving' | 'success' | 'error'

export type SaveState = {
  phase: SavePhase
  /** Human-readable summary of the most recent failure, if any. */
  error: string | null
  /** Per-key failures from the most recent attempt. */
  failures: Array<SaveFailure>
  /** Epoch ms of the last attempt that persisted at least one key. */
  lastSavedAt: number | null
}

export type SettingsState = {
  /** `empty` until a real server snapshot has been seeded. */
  status: 'empty' | 'seeded'
  /** Server truth, flattened to dotted keys. */
  committed: Record<string, unknown>
  /** Section-registered fallbacks. Never persisted, never exported. */
  defaults: Record<string, unknown>
  /** Unsaved user edits. Key set === `dirty`. */
  overlay: Record<string, unknown>
  /** Dense resolved view — see invariant 1. */
  draft: Record<string, unknown>
  dirty: Set<string>
  saveState: SaveState
}

export type SettingsActions = {
  /**
   * Install a server snapshot.
   *
   * Non-forced (the default) is a *background refetch*: `committed` is
   * replaced, but a key the user has edited keeps its draft value and stays
   * dirty — unless the new server value now equals the draft, in which case
   * the edit is simply redundant and the key goes clean. Self-saving sections
   * rely on this so they can `invalidateQueries(['config'])` after their own
   * write without nuking every other section's drafts.
   *
   * `{ force: true }` is the Refresh button: a hard reset that drops drafts.
   */
  seed: (
    committed: Record<string, unknown>,
    opts?: { force?: boolean },
  ) => void
  /**
   * Register fallback values for keys the server may not define. Additive,
   * idempotent and order-independent (first registration for a key wins).
   * Never touches `status`, `committed` or `dirty`.
   */
  registerDefaults: (defaults: Record<string, unknown>) => void
  set: (key: string, value: unknown) => void
  setMany: (patch: Record<string, unknown>) => void
  /**
   * Apply an imported settings object as unsaved edits. Returns how many keys
   * actually differ from current state, i.e. how many went dirty.
   */
  importValues: (values: Record<string, unknown>) => number
  discard: (key: string) => void
  discardKeys: (keys: Iterable<string>) => void
  discardAll: () => void
  /** Clear a lingering success/error phase without touching the data. */
  acknowledgeSave: () => void
  /** Persist dirty keys. Never throws. */
  save: (saver: SettingsSaverFn) => Promise<SaveOutcome>
}

export type SettingsStore = SettingsState & SettingsActions

const IDLE_SAVE: SaveState = {
  phase: 'idle',
  error: null,
  failures: [],
  lastSavedAt: null,
}

export const INITIAL_SETTINGS_STATE: SettingsState = {
  status: 'empty',
  committed: {},
  defaults: {},
  overlay: {},
  draft: {},
  dirty: new Set<string>(),
  saveState: IDLE_SAVE,
}

/** A fresh copy — `INITIAL_SETTINGS_STATE` holds a Set and must not be aliased. */
function freshState(): SettingsState {
  return {
    status: 'empty',
    committed: {},
    defaults: {},
    overlay: {},
    draft: {},
    dirty: new Set<string>(),
    saveState: IDLE_SAVE,
  }
}

function resolveDraft(state: {
  defaults: Record<string, unknown>
  committed: Record<string, unknown>
  overlay: Record<string, unknown>
}): Record<string, unknown> {
  return { ...state.defaults, ...state.committed, ...state.overlay }
}

/** The value a key falls back to when the user has no edit on it. */
function baseValue(
  state: Pick<SettingsState, 'committed' | 'defaults'>,
  key: string,
): unknown {
  return key in state.committed ? state.committed[key] : state.defaults[key]
}

/**
 * Apply `patch` as user edits. Touches only the patched keys — the dirty set
 * is never recomputed across the whole map, which matters once the generated
 * All-settings browser registers hundreds of keys.
 */
function applyEdits(
  state: SettingsState,
  patch: Record<string, unknown>,
): Partial<SettingsState> | null {
  const overlay = { ...state.overlay }
  const dirty = new Set(state.dirty)
  const draft = { ...state.draft }
  let changed = false

  for (const [key, value] of Object.entries(patch)) {
    const base = baseValue(state, key)
    if (valuesEqual(value, base)) {
      if (key in overlay) {
        delete overlay[key]
        dirty.delete(key)
        changed = true
      }
      draft[key] = base
      continue
    }
    if (key in overlay && valuesEqual(overlay[key], value)) {
      continue
    }
    overlay[key] = value
    dirty.add(key)
    draft[key] = value
    changed = true
  }

  if (!changed) return null
  return { overlay, dirty, draft }
}

function countNewlyDirty(
  before: Set<string>,
  after: Set<string> | undefined,
): number {
  if (!after) return 0
  let n = 0
  for (const key of after) if (!before.has(key)) n++
  return n
}

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  ...freshState(),

  seed(committed, opts) {
    const state = get()

    if (opts?.force) {
      set({
        status: 'seeded',
        committed,
        overlay: {},
        dirty: new Set<string>(),
        draft: { ...state.defaults, ...committed },
        saveState: IDLE_SAVE,
      })
      return
    }

    // Background refetch: new server truth underneath, drafts on top.
    const overlay: Record<string, unknown> = {}
    const dirty = new Set<string>()
    for (const [key, value] of Object.entries(state.overlay)) {
      const base = key in committed ? committed[key] : state.defaults[key]
      if (valuesEqual(value, base)) continue
      overlay[key] = value
      dirty.add(key)
    }

    set({
      status: 'seeded',
      committed,
      overlay,
      dirty,
      draft: { ...state.defaults, ...committed, ...overlay },
    })
  },

  registerDefaults(incoming) {
    const state = get()
    const added: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(incoming)) {
      if (key in state.defaults) continue
      added[key] = value
    }
    if (Object.keys(added).length === 0) return

    const defaults = { ...state.defaults, ...added }
    const draft = { ...state.draft }
    for (const [key, value] of Object.entries(added)) {
      // Server truth and user edits both outrank a registered default.
      if (key in state.committed || key in state.overlay) continue
      draft[key] = value
    }
    // Deliberately writes neither `status`, `committed` nor `dirty`.
    set({ defaults, draft })
  },

  set(key, value) {
    const next = applyEdits(get(), { [key]: value })
    if (next) set(next)
  },

  setMany(patch) {
    const next = applyEdits(get(), patch)
    if (next) set(next)
  },

  importValues(values) {
    const before = get().dirty
    const next = applyEdits(get(), values)
    if (!next) return 0
    set(next)
    return countNewlyDirty(before, next.dirty)
  },

  discard(key) {
    get().discardKeys([key])
  },

  discardKeys(keys) {
    const state = get()
    const overlay = { ...state.overlay }
    const dirty = new Set(state.dirty)
    const draft = { ...state.draft }
    let changed = false
    for (const key of keys) {
      if (!(key in overlay)) continue
      delete overlay[key]
      dirty.delete(key)
      draft[key] = baseValue(state, key)
      changed = true
    }
    if (!changed) return
    set({ overlay, dirty, draft })
  },

  discardAll() {
    const state = get()
    if (state.dirty.size === 0) return
    set({
      overlay: {},
      dirty: new Set<string>(),
      draft: { ...state.defaults, ...state.committed },
    })
  },

  acknowledgeSave() {
    const { saveState } = get()
    if (saveState.phase === 'idle' || saveState.phase === 'saving') return
    set({ saveState: { ...saveState, phase: 'idle' } })
  },

  async save(saver) {
    const state = get()
    // Re-entrant click while a save is in flight is a no-op.
    if (state.saveState.phase === 'saving') return { persisted: [], failed: [] }
    if (state.dirty.size === 0) {
      if (state.saveState.phase !== 'idle') {
        set({ saveState: { ...state.saveState, phase: 'idle', error: null, failures: [] } })
      }
      return { persisted: [], failed: [] }
    }

    const patch: Record<string, unknown> = {}
    state.dirty.forEach((key) => {
      patch[key] = state.draft[key]
    })

    set({
      saveState: {
        phase: 'saving',
        error: null,
        failures: [],
        lastSavedAt: state.saveState.lastSavedAt,
      },
    })

    let outcome: SaveOutcome
    try {
      outcome = await saver(patch)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      const failures = Object.keys(patch).map((key) => ({ key, reason }))
      set({
        saveState: {
          phase: 'error',
          error: reason,
          failures,
          lastSavedAt: get().saveState.lastSavedAt,
        },
      })
      // Nothing was committed and nothing left `dirty`.
      return { persisted: [], failed: failures }
    }

    const cur = get()
    const committed = { ...cur.committed }
    const overlay = { ...cur.overlay }
    const dirty = new Set(cur.dirty)

    for (const key of outcome.persisted) {
      committed[key] = patch[key]
      // A key edited again mid-flight has a different overlay value now and
      // must stay dirty.
      if (key in overlay && valuesEqual(overlay[key], patch[key])) {
        delete overlay[key]
        dirty.delete(key)
      }
    }

    const failed = outcome.failed
    set({
      committed,
      overlay,
      dirty,
      draft: { ...cur.defaults, ...committed, ...overlay },
      saveState: {
        phase: failed.length > 0 ? 'error' : 'success',
        error: failed.length > 0 ? failed[0].reason : null,
        failures: failed,
        lastSavedAt:
          outcome.persisted.length > 0 ? Date.now() : cur.saveState.lastSavedAt,
      },
    })

    return outcome
  },
}))

/** Restore the store to its initial shape. Test helper — see `INITIAL_SETTINGS_STATE`. */
export function resetSettingsStore(): void {
  useSettingsStore.setState(freshState())
}

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
