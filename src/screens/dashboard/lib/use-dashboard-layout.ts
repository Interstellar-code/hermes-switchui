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
 *
 * Iteration 015 (C — ops revamp): the new ops-section card
 * `token_mix_hour` is on-by-default — the social dashboard
 * spec lists it among the five default cards in the OPS & ANALYTICS
 * grid (chart, top models, cache efficiency, skills usage, tokens
 * by hour). A returning user whose stored layout pre-dates this
 * card will have it unioned in via the v4 -> v5 path in `readLayout`
 * so they keep whatever explicit choice they had.
 */
export const DEFAULT_HIDDEN: ReadonlyArray<WidgetId> = [
  'logs_tail',
  'provider_mix',
  'velocity',
  'cost_ledger',
  'operator_tip',
]

/**
 * Per-version migrations applied when reading a stored layout.
 *
 * Each entry maps a stored `version` (the version the user wrote) to
 * a function that takes the raw incoming `hidden` array and returns
 * a new array. Migrations accept `Array<string>` because the stored
 * value can contain ids that no longer exist in the current schema
 * (the whole point of running the migration is to rewrite them).
 *
 * Migrations are applied in declared order, oldest first, so a v1
 * entry passes through every step and lands on the current shape.
 * Migrations must NOT add new entries from `DEFAULT_HIDDEN` — that
 * union happens in `readLayout` so the same defaults are applied
 * whether the user had a stored value or not.
 */
const MIGRATIONS: ReadonlyArray<{
  from: number
  fn: (hidden: Array<string>) => Array<string>
}> = [
  // v4 -> v5 (iteration 015). The new ops-section card
  // `token_mix_hour` is added to the catalog. Users who had
  // `mix_rhythm` hidden keep that choice (it still exists for the
  // old dashboard screen until P2 removes it); `token_mix_hour` is
  // unioned in via `DEFAULT_HIDDEN` below so a returning user
  // doesn't see it re-enabled by accident. No rename is required
  // because both ids coexist in v5, so users who want the new
  // strip must opt in via EDIT LAYOUT.
]

/**
 * Storage schema version. Bump this whenever:
 *  - a widget id is added/removed/renamed (write a migration in
 *    `MIGRATIONS` so the user's stored choice carries over), OR
 *  - the default hidden set changes and returning users should
 *    pick up the new defaults while keeping their explicit hides.
 *
 * Bumping the version with no matching migration entry still works
 * (union with `DEFAULT_HIDDEN` runs in `readLayout`), but new ids
 * you want to keep will be silently dropped by the `valid` filter
 * unless you migrate them in.
 *
 * Exported so the layout hook's tests can seed a stored value with
 * the current version. Not part of the public API.
 */
export const STORAGE_VERSION = 5

function readLayout(): StoredLayout {
  if (typeof window === 'undefined') {
    return { hidden: [...DEFAULT_HIDDEN] }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { hidden: [...DEFAULT_HIDDEN] }
    const parsed = JSON.parse(raw) as StoredLayout & {
      version?: number
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
    const storedVersion = parsed.version ?? 0
    let migrated: Array<string> = incoming
    for (const step of MIGRATIONS) {
      if (storedVersion < step.from) {
        // The user stored before this step was introduced — the
        // union with `DEFAULT_HIDDEN` below will pick up the new
        // defaults; we don't need to rewrite their array because
        // their stored value already pre-dates the rename.
        continue
      }
      migrated = step.fn(migrated)
    }
    // Drop any ids that don't exist in the current catalog. Renamed
    // ids that were migrated above are kept; truly removed ids
    // disappear here, silently — the user's choice was for a card
    // that no longer exists, so there's nothing to preserve.
    const filtered = migrated.filter(
      (id): id is WidgetId =>
        typeof id === 'string' && valid.has(id as WidgetId),
    )
    if (storedVersion < STORAGE_VERSION) {
      // Pick up the new defaults so returning users don't suddenly
      // see widgets that are off-by-default in the current schema.
      // Their explicit hides are unioned, never overwritten.
      const merged = new Set<WidgetId>(filtered)
      for (const id of DEFAULT_HIDDEN) merged.add(id)
      return { hidden: Array.from(merged) }
    }
    return { hidden: filtered }
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
 * Kept as a hook (not a React Context) because the dashboard tree is
 * shallow enough that prop-drilling the result one level is cleaner
 * than threading a provider — and prop-drilling makes it obvious
 * which widgets actually consume the layout.
 */
export function useDashboardLayout() {
  const [editMode, setEditMode] = useState(false)
  const [hidden, setHidden] = useState<Set<WidgetId>>(
    () => new Set(readLayout().hidden),
  )

  // Persist on every change. Cheap; ~1KB max.
  useEffect(() => {
    writeLayout({ hidden: Array.from(hidden) })
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
