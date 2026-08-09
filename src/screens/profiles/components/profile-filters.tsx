import { useCallback, useEffect, useState } from 'react'
import type {
  ProfileFilterState,
  ProfilesViewMode,
} from '@/stores/profiles-screen-store'
import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  useProfilesViewStore,
} from '@/stores/profiles-screen-store'

/**
 * How long the search box waits before writing to the URL (G-07).
 *
 * This is the *only* debounce in the search path now. The value used to be
 * debounced again inside the screen; keeping both would stack them in series
 * and put 300ms between the last keystroke and the filtered list.
 */
export const SEARCH_DEBOUNCE_MS = 150

type Props = {
  models: Array<string>
  tags: Array<string>
  filters: ProfileFilterState
  onFilterChange: (
    patch: Partial<ProfileFilterState>,
    opts?: { replace?: boolean },
  ) => void
}

const TIER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '1', label: 'T1' },
  { value: '2', label: 'T2' },
  { value: '3', label: 'T3' },
] as const

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'idle', label: 'Idle' },
  { value: 'draft', label: 'Draft' },
] as const

export function ProfileFilters({
  models,
  tags,
  filters,
  onFilterChange,
}: Props) {
  const { tierFilter, statusFilter, modelFilter, tagFilter } = filters
  const { viewMode, setViewMode } = useProfilesViewStore()

  // The input stays instant; only the URL write waits. Without the local copy
  // the caret would fight a value that lags 150ms behind the keyboard.
  const [searchDraft, setSearchDraft] = useState(filters.search)

  // Adopt changes that came from anywhere other than this box — a deep link, a
  // back/forward step, "Clear filters".
  useEffect(() => {
    setSearchDraft(filters.search)
  }, [filters.search])

  useEffect(() => {
    if (searchDraft === filters.search) return
    const id = setTimeout(() => {
      // `replace` so a ten-character query leaves ONE history entry instead of
      // ten, and Back means "before I searched" rather than "one letter ago".
      onFilterChange({ search: searchDraft }, { replace: true })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [searchDraft, filters.search, onFilterChange])

  const resetFilters = useCallback(() => {
    setSearchDraft(DEFAULT_FILTERS.search)
    onFilterChange({ ...DEFAULT_FILTERS })
  }, [onFilterChange])

  return (
    <div className="pf-filter-bar">
      {/* Search */}
      <div className="pf-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="text"
          placeholder="Search agents..."
          aria-label="Search agents"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
        />
      </div>

      {/* Pills */}
      <div className="pf-pills-row">
        {/* Tier */}
        <span className="pf-pill-label">Tier</span>
        <div className="pf-pill-group">
          {TIER_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`filter-pill${tierFilter === o.value ? ' filter-pill--active' : ''}`}
              onClick={() => onFilterChange({ tierFilter: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="pf-pills-divider" />

        {/* Status */}
        <span className="pf-pill-label">Status</span>
        <div className="pf-pill-group">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`filter-pill${statusFilter === o.value ? ' filter-pill--active' : ''}`}
              onClick={() => onFilterChange({ statusFilter: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>

        {models.length > 0 && (
          <>
            <div className="pf-pills-divider" />
            <span className="pf-pill-label">Model</span>
            <div className="pf-pill-group">
              <button
                type="button"
                className={`filter-pill${modelFilter === 'all' ? ' filter-pill--active' : ''}`}
                onClick={() => onFilterChange({ modelFilter: 'all' })}
              >
                All
              </button>
              {models.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`filter-pill${modelFilter === m ? ' filter-pill--active' : ''}`}
                  onClick={() => onFilterChange({ modelFilter: m })}
                >
                  {m}
                </button>
              ))}
            </div>
          </>
        )}

        {tags.length > 0 && (
          <>
            <div className="pf-pills-divider" />
            <span className="pf-pill-label">Tag</span>
            <div className="pf-pill-group">
              <button
                type="button"
                className={`filter-pill${tagFilter === 'all' ? ' filter-pill--active' : ''}`}
                onClick={() => onFilterChange({ tagFilter: 'all' })}
              >
                All
              </button>
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`filter-pill${tagFilter === t ? ' filter-pill--active' : ''}`}
                  onClick={() => onFilterChange({ tagFilter: t })}
                >
                  {t}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Clear filters */}
      {hasActiveFilters(filters) && (
        <button
          type="button"
          className="pf-clear-filters"
          onClick={resetFilters}
        >
          Clear filters
        </button>
      )}

      {/* View toggle */}
      <div className="pf-view-toggle">
        {(['grid', 'table'] as Array<ProfilesViewMode>).map((mode) => (
          <button
            key={mode}
            type="button"
            className={viewMode === mode ? 'on' : ''}
            onClick={() => setViewMode(mode)}
            title={mode === 'grid' ? 'Grid view' : 'Table view'}
          >
            {mode === 'grid' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
