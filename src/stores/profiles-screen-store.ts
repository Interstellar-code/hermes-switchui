/**
 * profiles-screen-store.ts — Profiles screen UI state.
 *
 * Two kinds of state, deliberately kept in two different places (G-07):
 *
 *   • **Device preferences** — view mode and page size. They describe *this
 *     browser*, not *this list*, so they stay in localStorage
 *     (`switchui-profiles-view`) and never appear in the URL. Sending someone a
 *     link should not retheme their screen.
 *
 *   • **What you are looking at** — search, tier, status, model, tag, page.
 *     These are shareable and reload-survivable, so the **URL is their single
 *     source of truth**. There is no Zustand mirror: a mirror would be a second
 *     writable copy, and the two can disagree the moment a back button, a
 *     deep link, or a `navigate()` moves one without the other. The screen
 *     reads `Route.useSearch()` and writes with `navigate()`; this module owns
 *     only the *pure* encode/decode between the two shapes so both directions
 *     are testable without a router.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { WizardStep } from '@/screens/profiles/types'

export type ProfilesViewMode = 'grid' | 'table'

type ProfilesPersistedState = {
  viewMode: ProfilesViewMode
  pageSizeGrid: number
  pageSizeTable: number
}

export const PAGE_SIZES_GRID = [12, 24, 48, 96] as const
export const PAGE_SIZES_TABLE = [25, 50, 100, 200] as const
export const DEFAULT_PAGE_SIZE_GRID = 24
export const DEFAULT_PAGE_SIZE_TABLE = 50

// Persisted slice — view mode + page sizes per view (device preferences)
export const useProfilesViewStore = create<
  ProfilesPersistedState & {
    setViewMode: (m: ProfilesViewMode) => void
    setPageSize: (n: number) => void
  }
>()(
  persist(
    (set) => ({
      viewMode: 'grid',
      pageSizeGrid: DEFAULT_PAGE_SIZE_GRID,
      pageSizeTable: DEFAULT_PAGE_SIZE_TABLE,
      setViewMode: (viewMode) => set({ viewMode }),
      setPageSize: (n) =>
        set((s) =>
          s.viewMode === 'grid' ? { pageSizeGrid: n } : { pageSizeTable: n },
        ),
    }),
    {
      name: 'switchui-profiles-view',
      version: 1,
      migrate: (persisted, fromVersion) => {
        if (fromVersion === 1) return persisted as ProfilesPersistedState
        return {
          viewMode: 'grid' as ProfilesViewMode,
          pageSizeGrid: DEFAULT_PAGE_SIZE_GRID,
          pageSizeTable: DEFAULT_PAGE_SIZE_TABLE,
        }
      },
    },
  ),
)

// Derived selector — current page size based on active view
export function usePageSize(): number {
  const { viewMode, pageSizeGrid, pageSizeTable } = useProfilesViewStore()
  return viewMode === 'grid' ? pageSizeGrid : pageSizeTable
}

// ── Filter state ⇄ URL search params ─────────────────────────────────────────

export type TierFilter = 'all' | '1' | '2' | '3'
export type StatusFilter = 'all' | 'active' | 'idle' | 'draft'

export type ProfileFilterState = {
  search: string
  tierFilter: TierFilter
  statusFilter: StatusFilter
  modelFilter: string
  tagFilter: string
  page: number
}

/**
 * The values that mean "no filter". Anything equal to one of these is **left
 * out of the URL** so `/profiles` stays `/profiles` rather than
 * `?tier=all&status=all&model=all&tag=all&page=1`.
 */
export const DEFAULT_FILTERS: ProfileFilterState = {
  search: '',
  tierFilter: 'all',
  statusFilter: 'all',
  modelFilter: 'all',
  tagFilter: 'all',
  page: 1,
}

export const TOTAL_WIZARD_STEPS = 9

/**
 * `?step=` is a hint from a doc, a toast, or a support chat — never trusted.
 * Anything that is not a usable step number collapses to step 1, and out-of-range
 * numbers clamp rather than reject, so a link written against a 12-step wizard
 * still lands somewhere real.
 */
export function clampWizardStep(value: unknown): WizardStep {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(n)) return 1
  const clamped = Math.min(TOTAL_WIZARD_STEPS, Math.max(1, Math.trunc(n)))
  return clamped as WizardStep
}

const TIER_VALUES = ['1', '2', '3'] as const
const STATUS_VALUES = ['active', 'idle', 'draft'] as const

/**
 * TanStack's default search parser runs every raw value through `JSON.parse`
 * first, so `?tier=2` arrives as the **number** 2 and `?q=42` as the number 42.
 * Every field therefore coerces to a string before it is validated — a plain
 * `z.enum()` or `z.string()` would silently drop exactly the filters people are
 * most likely to link to. `.catch(undefined)` is deliberate too: a malformed
 * hand-edited param should degrade to "no filter", not throw the screen into
 * its error boundary.
 */
export const profilesSearchSchema = z.object({
  q: z.coerce.string().min(1).optional().catch(undefined),
  tier: z.coerce
    .string()
    .pipe(z.enum(TIER_VALUES))
    .optional()
    .catch(undefined),
  status: z.coerce
    .string()
    .pipe(z.enum(STATUS_VALUES))
    .optional()
    .catch(undefined),
  model: z.coerce.string().min(1).optional().catch(undefined),
  tag: z.coerce.string().min(1).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  /** Deep link: open the wizard on this profile. */
  edit: z.coerce.string().min(1).optional().catch(undefined),
  /** Deep link: open the wizard at this step. Clamped, never rejected. */
  step: z.coerce
    .number()
    .optional()
    .catch(undefined)
    .transform((v) => (v === undefined ? undefined : clampWizardStep(v))),
})

export type ProfilesSearch = z.infer<typeof profilesSearchSchema>

/** The filter half of the search params — `edit`/`step` are the wizard's. */
export type ProfilesFilterSearch = Pick<
  ProfilesSearch,
  'q' | 'tier' | 'status' | 'model' | 'tag' | 'page'
>

/** URL → filters. Absent means default. */
export function searchToFilters(
  search: ProfilesFilterSearch,
): ProfileFilterState {
  return {
    search: search.q ?? DEFAULT_FILTERS.search,
    tierFilter: search.tier ?? DEFAULT_FILTERS.tierFilter,
    statusFilter: search.status ?? DEFAULT_FILTERS.statusFilter,
    modelFilter: search.model ?? DEFAULT_FILTERS.modelFilter,
    tagFilter: search.tag ?? DEFAULT_FILTERS.tagFilter,
    page: search.page ?? DEFAULT_FILTERS.page,
  }
}

/**
 * Filters → URL. Defaults become `undefined`, which the router omits from the
 * query string entirely; spreading the result over the previous search
 * therefore both *sets* changed filters and *clears* the ones returning to
 * default, without touching `edit`/`step`.
 */
export function filtersToSearch(
  filters: ProfileFilterState,
): ProfilesFilterSearch {
  return {
    q: filters.search === DEFAULT_FILTERS.search ? undefined : filters.search,
    tier: filters.tierFilter === 'all' ? undefined : filters.tierFilter,
    status: filters.statusFilter === 'all' ? undefined : filters.statusFilter,
    model: filters.modelFilter === 'all' ? undefined : filters.modelFilter,
    tag: filters.tagFilter === 'all' ? undefined : filters.tagFilter,
    page: filters.page <= DEFAULT_FILTERS.page ? undefined : filters.page,
  }
}

/**
 * Changing any filter sends you back to page 1 — page 4 of the old result set
 * is meaningless against the new one, and the old store did this too. Setting
 * the page explicitly is the one patch that keeps it.
 */
export function applyFilterPatch(
  current: ProfileFilterState,
  patch: Partial<ProfileFilterState>,
): ProfileFilterState {
  const next = { ...current, ...patch }
  if (patch.page === undefined) next.page = DEFAULT_FILTERS.page
  return next
}

/** Whether the "Clear filters" affordance should appear. Page is not a filter. */
export function hasActiveFilters(filters: ProfileFilterState): boolean {
  return (
    filters.search !== DEFAULT_FILTERS.search ||
    filters.tierFilter !== DEFAULT_FILTERS.tierFilter ||
    filters.statusFilter !== DEFAULT_FILTERS.statusFilter ||
    filters.modelFilter !== DEFAULT_FILTERS.modelFilter ||
    filters.tagFilter !== DEFAULT_FILTERS.tagFilter
  )
}
