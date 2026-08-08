'use client'

import { Ico } from '../icons'
import type { ProviderCounts } from '../hooks/use-providers'
import type { ProviderStatus } from '../lib/provider-view'

export type StatusFilter = ProviderStatus | 'all'
export type OriginFilter = 'all' | 'hosted' | 'local'
export type AuthFilter = 'all' | 'api-key' | 'oauth' | 'cli-token' | 'local'
export type ModelsFilter = 'all' | 'has' | 'unknown'

export type ProviderFilters = {
  search: string
  status: StatusFilter
  origin: OriginFilter
  auth: AuthFilter
  models: ModelsFilter
}

export const EMPTY_FILTERS: ProviderFilters = {
  search: '',
  status: 'all',
  origin: 'all',
  auth: 'all',
  models: 'all',
}

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'ready', label: 'Ready' },
  { value: 'needs-key', label: 'Needs key' },
  { value: 'offline', label: 'Offline' },
  { value: 'available', label: 'Available' },
]

const AUTH_OPTIONS: Array<{ value: AuthFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'api-key', label: 'API key' },
  { value: 'oauth', label: 'OAuth' },
  { value: 'cli-token', label: 'CLI token' },
  { value: 'local', label: 'Local' },
]

type Props = {
  filters: ProviderFilters
  counts: ProviderCounts
  collapsed: boolean
  onChange: (next: ProviderFilters) => void
  onToggleCollapsed: () => void
  onAddProvider: () => void
}

export function ProviderFilterRail({
  filters,
  counts,
  collapsed,
  onChange,
  onToggleCollapsed,
  onAddProvider,
}: Props) {
  const set = <TKey extends keyof ProviderFilters>(
    key: TKey,
    value: ProviderFilters[TKey],
  ) => onChange({ ...filters, [key]: value })

  if (collapsed) {
    return (
      <aside className="pv-filter is-collapsed">
        <div className="pv-filter-rail">
          <button
            type="button"
            className="pv-ico-btn"
            onClick={onToggleCollapsed}
            aria-label="Expand filters"
            title="Expand filters"
          >
            {Ico.unfold}
          </button>
          <span className="pv-badge-n">{counts.total}</span>
          <button
            type="button"
            className="pv-ico-btn"
            onClick={onAddProvider}
            aria-label="Add provider"
            title="Add provider"
          >
            {Ico.plus}
          </button>
          <span className="pv-vlabel">Providers</span>
        </div>
      </aside>
    )
  }

  return (
    <aside className="pv-filter">
      <div className="pv-filter-hdr">
        <h3>Providers</h3>
        <span className="pv-ct">{counts.total}</span>
        <div className="pv-actions">
          <button
            type="button"
            className="pv-ico-btn"
            onClick={onToggleCollapsed}
            aria-label="Collapse filters"
            title="Collapse filters"
          >
            {Ico.fold}
          </button>
        </div>
      </div>

      <div className="pv-filter-search">
        <input
          type="search"
          value={filters.search}
          placeholder="Search providers…"
          aria-label="Search providers"
          onChange={(event) => set('search', event.target.value)}
        />
      </div>

      <div className="pv-filter-body">
        <div className="pv-filter-grp">
          <h4>Status</h4>
        </div>
        <div className="pv-seg-stack">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={filters.status === option.value ? 'on' : undefined}
              onClick={() => set('status', option.value)}
            >
              {option.label}
              <span className="pv-ct">
                {option.value === 'all'
                  ? counts.total
                  : counts.byStatus[option.value]}
              </span>
            </button>
          ))}
        </div>

        <div className="pv-filter-grp">
          <h4>Origin</h4>
        </div>
        {(['all', 'hosted', 'local'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`pv-opt-row${filters.origin === value ? ' on' : ''}`}
            onClick={() => set('origin', value)}
          >
            <span className="pv-dot" />
            {value === 'all' ? 'All' : value === 'hosted' ? 'Hosted' : 'Local'}
            <span className="pv-ct">
              {value === 'all' ? counts.total : counts.byOrigin[value]}
            </span>
          </button>
        ))}

        <div className="pv-filter-grp">
          <h4>Auth</h4>
        </div>
        {AUTH_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`pv-opt-row${filters.auth === option.value ? ' on' : ''}`}
            onClick={() => set('auth', option.value)}
          >
            <span className="pv-dot" />
            {option.label}
            <span className="pv-ct">
              {option.value === 'all'
                ? counts.total
                : (counts.byAuth[option.value] ?? 0)}
            </span>
          </button>
        ))}

        <div className="pv-filter-grp">
          <h4>Models</h4>
        </div>
        {(['all', 'has', 'unknown'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`pv-opt-row${filters.models === value ? ' on' : ''}`}
            onClick={() => set('models', value)}
          >
            <span className="pv-dot" />
            {value === 'all'
              ? 'All'
              : value === 'has'
                ? 'Has models'
                : 'Unknown'}
            <span className="pv-ct">
              {value === 'all'
                ? counts.total
                : value === 'has'
                  ? counts.withModels
                  : counts.modelsUnknown}
            </span>
          </button>
        ))}
      </div>

      <div className="pv-filter-foot">
        <button
          type="button"
          className="pv-btn pv-btn-primary"
          onClick={onAddProvider}
        >
          {Ico.plus} Add Provider
        </button>
        <span className="pv-source">config.yaml · {counts.total} known</span>
      </div>
    </aside>
  )
}

/** Client-side filtering — the whole set is small and already in memory. */
export function applyProviderFilters<
  T extends {
    id: string
    name: string
    baseUrl: string | null
    status: ProviderStatus
    origin: 'hosted' | 'local'
    authKind: string
    modelCount: number
    modelsUnknown: boolean
    models: Array<{ id: string }>
  },
>(views: Array<T>, filters: ProviderFilters): Array<T> {
  const query = filters.search.trim().toLowerCase()

  return views.filter((view) => {
    if (filters.status !== 'all' && view.status !== filters.status) return false
    if (filters.origin !== 'all' && view.origin !== filters.origin) return false
    if (filters.auth !== 'all' && view.authKind !== filters.auth) return false
    if (filters.models === 'has' && view.modelCount === 0) return false
    if (filters.models === 'unknown' && !view.modelsUnknown) return false

    if (!query) return true
    const haystack = [
      view.id,
      view.name,
      view.baseUrl ?? '',
      ...view.models.map((model) => model.id),
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })
}
