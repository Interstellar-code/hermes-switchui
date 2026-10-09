import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Storage key. Exported so the layout hook's tests can read/write
 * the same slot the hook does. Not part of the public API.
 */
export const STORAGE_KEY = 'dashboard.layout.v1'

/**
 * Catalog of hideable widgets. The order here is also the *default
 * display order* on the side rail / main column, so adding a new
 * widget = adding it here in the right position.
 *
 * `column` distinguishes main column from side rail so the edit panel
 * can group them sensibly in the picker UI.
 */
export type WidgetId =
  | 'analytics_chart'
  | 'top_models'
  | 'provider_mix'
  | 'cache_efficiency'
  | 'velocity'
  | 'cost_ledger'
  | 'sessions_intelligence'
  | 'logs_tail'
  | 'operator_tip'
  | 'skills_usage'
  | 'achievements'
  | 'mix_rhythm'
  | 'token_mix_hour'

export type WidgetMeta = {
  id: WidgetId
  label: string
  description: string
  column: 'main' | 'rail'
  /** Defaults to true; widgets opt-in to being hideable explicitly so
   *  we can keep "Attention" mandatory if we want, etc. */
  hideable: boolean
}

export const WIDGET_CATALOG: ReadonlyArray<WidgetMeta> = [
  {
    id: 'analytics_chart',
    label: 'Analytics chart',
    description: 'Tokens/sessions/calls trend with period switcher.',
    column: 'main',
    hideable: true,
  },
  {
    id: 'top_models',
    label: 'Top models',
    description: 'Routing share by model in the analytics window.',
    column: 'main',
    hideable: true,
  },
  {
    id: 'provider_mix',
    label: 'Provider mix',
    description:
      'Token share by provider family (anthropic / openai / local / etc).',
    column: 'main',
    hideable: true,
  },
  {
    id: 'cache_efficiency',
    label: 'Cache efficiency',
    description: 'Cache-hit rate with daily sparkline. Higher = lower cost.',
    column: 'main',
    hideable: true,
  },
  {
    id: 'velocity',
    label: 'Velocity',
    description: 'Sessions/day average + delta vs prior period + sparkline.',
    column: 'main',
    hideable: true,
  },
  {
    id: 'cost_ledger',
    label: 'Cost ledger',
    description:
      'Per-model cost split between paid providers and subscription/local.',
    column: 'main',
    hideable: true,
  },
  {
    id: 'sessions_intelligence',
    label: 'Sessions intelligence',
    description: 'Recent sessions with token / tool / status badges.',
    column: 'main',
    hideable: true,
  },
  {
    id: 'logs_tail',
    label: 'Live logs',
    description:
      'Tail of the gateway log stream. Off by default in iter 006 — enable here when triaging.',
    column: 'main',
    hideable: true,
  },
  {
    id: 'operator_tip',
    label: 'Operator tip',
    description:
      'Context-aware tip that adapts to the live overview (cache, cron, drift, etc.).',
    column: 'main',
    hideable: true,
  },
  {
    id: 'skills_usage',
    label: 'Skills usage',
    description: 'Top-5 used skills as a bar chart.',
    column: 'rail',
    hideable: true,
  },
  {
    id: 'achievements',
    label: 'Achievements',
    description: 'Recent unlocks & progress.',
    column: 'rail',
    hideable: true,
  },
  {
    id: 'mix_rhythm',
    label: 'Mix & rhythm',
    description: 'Token mix + hour-of-day activity strip.',
    column: 'rail',
    hideable: true,
  },
  {
    id: 'token_mix_hour',
    label: 'Tokens by hour',
    description: 'Hour-of-day token-usage strip (ops section).',
    column: 'rail',
    hideable: true,
  },
]

type StoredLayout = {
  hidden: Array<WidgetId>
}

/**
 * The hidden-by-default widget set. Exported so tests and any future
 * "Reset" UI can reason about the same canonical list the hook
 * writes when no stored value is present.
 *
 * Iteration 014 defaults:
 * - Logs Tail off (triage tool, not a default).
 * - Provider Mix off (Eric kept Cache only).
 * - Velocity, Cost Ledger off (live in the menu so the picker
 *   actually has interesting opt-in widgets).
 * - Operator Tip off too — Eric's call after iter 013, the bottom-
 *   of-column gap is better solved by Sessions Intelligence's
 *   flex-1 stretch than by an additional card. Tip stays available
 *   in the edit menu for users who want a contextual nudge.
 * Attention is no longer a widget id at all (it moved into OpsStrip).
 */
export const DEFAULT_HIDDEN: ReadonlyArray<WidgetId> = [
  'logs_tail',
  'provider_mix',
  'velocity',
  'cost_ledger',
  'operator_tip',
]

/**
 * In-tab subscriber set so multiple `useDashboardLayout()` instances
 * mounted at once (legacy screen + ops section) stay in sync. A write
 * in one instance calls `notifySubscribers()`; every other instance
 * re-reads from localStorage and updates its state. We do not rely
 * on the browser's `storage` event because that only fires for
 * changes from *other* tabs — same-tab writes need an explicit
 * fan-out.
 */
const subscribers = new Set<() => void>()

function notifySubscribers(): void {
  for (const fn of subscribers) fn()
}

/**
 * Storage schema version. Bump this whenever:
 *  - a widget id is added/removed/renamed (write a migration in
 *    `MIGRATIONS` so the user's stored choice carries over), OR
 *  - the default hidden set changes and returning users should
 *    pick up the new defaults while keeping their explicit hides.
 *
 * Exported so the layout hook's tests can seed a stored value with
 * the current version. Not part of the public API.
 */
export const STORAGE_VERSION = 4

/**
 * Per-version migrations applied when reading a stored layout. Empty
 * today; the v4 -> v4 (id `token_mix_hour` added) path needs no
 * migration because the new id is not in `DEFAULT_HIDDEN`, so
 * returning users do not need to have it unioned in. The hook
 * keeps the migration shape so future bumps have a place to land.
 */
const MIGRATIONS: ReadonlyArray<{
  from: number
  fn: (hidden: Array<string>) => Array<string>
}> = []

function readLayout(): StoredLayout {
  if (typeof window === 'undefined') {
    return { hidden: [...DEFAULT_HIDDEN] }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { hidden: [...DEFAULT_HIDDEN] }
    const parsed = JSON.parse(raw) as {
      hidden?: unknown
      version?: unknown
    }
    // Unknown / future / non-number version: fall back to defaults.
    // A returning user with a stored value from a build that wrote
    // a higher number than we know about would otherwise load with
    // a half-migrated set; the safer choice is to start clean and
    // let them re-pick any non-default opt-ins.
    if (
      typeof parsed.version !== 'number' ||
      parsed.version > STORAGE_VERSION
    ) {
      return { hidden: [...DEFAULT_HIDDEN] }
    }
    const valid = new Set<WidgetId>(WIDGET_CATALOG.map((w) => w.id))
    // `parsed.hidden` is declared as `Array<WidgetId>` but JSON.parse
    // can return any shape — the cast widens it so the migrations and
    // the `valid` filter can drop entries that no longer exist in
    // the catalog without a separate type-narrowing pass.
    const incoming: Array<string> = Array.isArray(parsed.hidden)
      ? (parsed.hidden as Array<unknown>).filter(
          (id): id is string => typeof id === 'string',
        )
      : []
    // Apply migrations in declared order so a v1 stored value passes
    // through every applicable step and lands on the current shape.
    const storedVersion = parsed.version
    let migrated: Array<string> = incoming
    for (const step of MIGRATIONS) {
      if (storedVersion < step.from) {
        // The user stored before this step was introduced — there's
        // nothing to rewrite, their array is already in the old shape.
        continue
      }
      migrated = step.fn(migrated)
    }
    // Drop any ids that don't exist in the current catalog. Renamed
    // ids that were migrated above are kept; truly removed ids
    // disappear here, silently — the user's choice was for a card
    // that no longer exists, so there's nothing to preserve.
    return {
      hidden: migrated.filter(
        (id): id is WidgetId =>
          typeof id === 'string' && valid.has(id as WidgetId),
      ),
    }
  } catch {
    return { hidden: [...DEFAULT_HIDDEN] }
  }
}

function writeLayout(layout: StoredLayout) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...layout, version: STORAGE_VERSION }),
    )
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

/**
 * Dashboard widget layout hook. Owns:
 * - which widgets are hidden (persisted to localStorage)
 * - whether the dashboard is in edit mode
 *
 * Returns helpers for individual widgets to ask "am I visible?" and
 * for the edit panel to flip widgets on/off.
 *
 * Multiple instances of this hook in the same tab share state via
 * a module-level subscriber fan-out (see `notifySubscribers`).
 * Earlier revisions kept state inside `useState`, so two mounted
 * instances (the legacy screen + the new ops section, both on the
 * dashboard at once after P2) would each own their own `hidden`
 * set and overwrite each other's writes to localStorage on every
 * change. The fan-out keeps every instance reflecting the latest
 * persisted set.
 */
export function useDashboardLayout() {
  const [editMode, setEditMode] = useState(false)
  const [hidden, setHidden] = useState<Set<WidgetId>>(
    () => new Set(readLayout().hidden),
  )

  // Subscribe to other instances' writes so we re-read from
  // localStorage and update local state. The subscriber does not
  // call `setHidden` from inside a `useEffect` body directly —
  // React requires a state updater to be invoked from the render
  // phase, so we wrap the call in a guarded `setHidden` that
  // re-reads only when our local state diverges from the persisted
  // set. This is also why the test for "two instances stay in
  // sync" uses `act()` — React 18 batches state updates across
  // the subscribers.
  useEffect(() => {
    const cb = () => {
      setHidden((prev) => {
        const next = new Set(readLayout().hidden)
        if (next.size === prev.size) {
          let same = true
          for (const id of next) {
            if (!prev.has(id)) {
              same = false
              break
            }
          }
          if (same) return prev
        }
        return next
      })
    }
    subscribers.add(cb)
    return () => {
      subscribers.delete(cb)
    }
  }, [])

  // Persist on every change. Cheap; ~1KB max.
  useEffect(() => {
    writeLayout({ hidden: Array.from(hidden) })
    notifySubscribers()
  }, [hidden])

  const toggleEdit = useCallback(() => setEditMode((v) => !v), [])

  const hide = useCallback((id: WidgetId) => {
    setHidden((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const show = useCallback((id: WidgetId) => {
    setHidden((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  // Reset returns to the iteration-006 defaults rather than "show
  // literally everything" so first-time users hitting Reset don't
  // suddenly see Logs they never asked for.
  const reset = useCallback(() => setHidden(new Set(DEFAULT_HIDDEN)), [])

  const isVisible = useCallback((id: WidgetId) => !hidden.has(id), [hidden])

  const counts = useMemo(() => {
    const total = WIDGET_CATALOG.length
    return {
      total,
      visible: total - hidden.size,
      hidden: hidden.size,
    }
  }, [hidden])

  return {
    editMode,
    toggleEdit,
    setEditMode,
    hidden,
    hide,
    show,
    reset,
    isVisible,
    counts,
  }
}

export type DashboardLayout = ReturnType<typeof useDashboardLayout>
