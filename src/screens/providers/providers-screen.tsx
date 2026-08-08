'use client'

/**
 * providers-screen.tsx — Providers inventory.
 *
 * Follows the house pattern from /mcp and /skills: a collapsible filter rail
 * beside a main column of header → toolbar → canvas → status bar, with all
 * filtering done client-side over an in-memory view model.
 *
 * Catalog providers that are not in config.yaml render as `available` cards —
 * the shelf you add from — so "add a provider" is one click from the thing you
 * want rather than buried in a wizard's first step.
 */
import { useMemo, useState } from 'react'
import { ProviderCard } from './components/provider-card'
import {
  EMPTY_FILTERS,
  ProviderFilterRail,
  applyProviderFilters,
} from './components/provider-filter-rail'
import { ProviderTable } from './components/provider-table'
import { ProviderWizardDialog } from './components/provider-wizard-dialog'
import { ProviderDetailDrawer } from './provider-detail-drawer'
import { useProviderMutations } from './hooks/use-provider-mutations'
import { useProviders } from './hooks/use-providers'
import { Ico } from './icons'
import type { ProviderFilters } from './components/provider-filter-rail'
import type { ProviderView } from './lib/provider-view'
import BackendUnavailableState from '@/components/backend-unavailable-state'
import { useFeatureAvailable } from '@/hooks/use-feature-available'
import { getUnavailableReason } from '@/lib/feature-gates'
import { toast } from '@/components/ui/toast'
import '@/styles/matrix-providers.css'

type SortKey = 'status' | 'name' | 'models'

const SORT_LABEL: Record<SortKey, string> = {
  status: 'Status',
  name: 'Name',
  models: 'Models',
}

export function ProvidersScreen() {
  const configAvailable = useFeatureAvailable('config')
  const { views, counts, activeProvider, isPending, error, refetch } =
    useProviders()
  const { restartGateway, deleteProvider, setActive } = useProviderMutations()

  const [filters, setFilters] = useState<ProviderFilters>(EMPTY_FILTERS)
  const [collapsed, setCollapsed] = useState(false)
  const [view, setView] = useState<'grid' | 'table'>('grid')
  const [sort, setSort] = useState<SortKey>('status')
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardProviderId, setWizardProviderId] = useState<string | null>(null)
  const [restartPending, setRestartPending] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  // Track by id, not by object, so the drawer re-renders with fresh data after
  // a mutation invalidates the queries.
  const openProvider = useMemo(
    () => views.find((candidate) => candidate.id === openId) ?? null,
    [views, openId],
  )

  const visible = useMemo(() => {
    const filtered = applyProviderFilters(views, filters)
    if (sort === 'name') {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
    }
    if (sort === 'models') {
      return [...filtered].sort((a, b) => b.modelCount - a.modelCount)
    }
    return filtered // already status-ranked by buildProviderViews
  }, [views, filters, sort])

  function openWizard(providerId: string | null) {
    setWizardProviderId(providerId)
    setWizardOpen(true)
  }

  function handleOpen(target: ProviderView) {
    setOpenId(target.id)
  }

  async function handleDelete(target: ProviderView) {
    try {
      const result = await deleteProvider.mutateAsync({
        providerId: target.id,
      })
      setOpenId(null)
      setRestartPending(true)
      toast(
        result.clearedActiveProvider
          ? `${target.name} removed — active provider reassigned.`
          : `${target.name} removed.`,
        { type: 'success' },
      )
    } catch (deleteError) {
      toast(
        deleteError instanceof Error
          ? deleteError.message
          : 'Could not remove the provider',
        { type: 'error' },
      )
    }
  }

  async function handleSetActive(target: ProviderView) {
    try {
      await setActive.mutateAsync({
        providerId: target.id,
        model: target.activeModel ?? undefined,
      })
      setRestartPending(true)
      toast(`${target.name} is now the active provider.`, { type: 'success' })
    } catch (activateError) {
      toast(
        activateError instanceof Error
          ? activateError.message
          : 'Could not switch provider',
        { type: 'error' },
      )
    }
  }

  async function handleRestart() {
    try {
      await restartGateway.mutateAsync()
      setRestartPending(false)
      toast('Gateway restart requested', { type: 'success' })
    } catch (restartError) {
      toast(
        restartError instanceof Error
          ? restartError.message
          : 'Could not restart the gateway',
        { type: 'error' },
      )
    }
  }

  if (!configAvailable) {
    return (
      <div data-screen="providers" className="pv-shell">
        <BackendUnavailableState
          feature="Providers"
          description={getUnavailableReason('config')}
        />
      </div>
    )
  }

  return (
    <div
      data-screen="providers"
      className={`pv-shell${collapsed ? ' pv-filters-collapsed' : ''}`}
    >
      <ProviderFilterRail
        filters={filters}
        counts={counts}
        collapsed={collapsed}
        onChange={setFilters}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onAddProvider={() => openWizard(null)}
      />

      <main className="pv-main">
        <header className="pv-top">
          <div>
            <div className="pv-crumbs">
              Settings <span className="pv-sep">/</span> Providers
            </div>
            <h1>Providers</h1>
            <p className="pv-sub">
              Connect model providers and choose which one Hermes Agent uses.
            </p>
          </div>
          <div className="pv-right">
            <div className="pv-stat">
              <b>{counts.configured}</b>
              Configured
            </div>
            <div className="pv-stat">
              <b>{activeProvider?.name ?? '—'}</b>
              Active
            </div>
            <div className="pv-stat">
              <b>{counts.totalModels}</b>
              Models
            </div>
          </div>
        </header>

        {restartPending ? (
          <div className="pv-banner">
            {Ico.warn}
            <span className="pv-grow">
              Config saved. The gateway only reads it at startup — restart for
              the change to take effect.
            </span>
            <button
              type="button"
              className="pv-btn pv-btn-sm"
              onClick={() => void handleRestart()}
              disabled={restartGateway.isPending}
            >
              {restartGateway.isPending ? 'Restarting…' : 'Restart gateway'}
            </button>
          </div>
        ) : null}

        <div className="pv-toolbar">
          <span className="pv-count">
            <b>{visible.length}</b> of {counts.total}
          </span>
          <span className="pv-grow" />
          <button
            type="button"
            className="pv-sort"
            onClick={() =>
              setSort((current) =>
                current === 'status'
                  ? 'name'
                  : current === 'name'
                    ? 'models'
                    : 'status',
              )
            }
          >
            Sort: {SORT_LABEL[sort]}
          </button>
          <div className="pv-view-toggle">
            <button
              type="button"
              className={view === 'grid' ? 'on' : undefined}
              onClick={() => setView('grid')}
              aria-label="Grid view"
            >
              {Ico.grid} Grid
            </button>
            <button
              type="button"
              className={view === 'table' ? 'on' : undefined}
              onClick={() => setView('table')}
              aria-label="Table view"
            >
              {Ico.rows} Table
            </button>
          </div>
          <button
            type="button"
            className="pv-ico-btn"
            onClick={refetch}
            aria-label="Refresh"
            title="Refresh"
          >
            {Ico.refresh}
          </button>
        </div>

        <div className="pv-canvas">
          {error ? (
            <div className="pv-empty">
              <div className="pv-glyph">!</div>
              <div>Could not load providers.</div>
              <div style={{ marginTop: 10 }}>
                <button type="button" className="pv-btn" onClick={refetch}>
                  Retry
                </button>
              </div>
            </div>
          ) : isPending ? (
            <div className="pv-empty">
              <div className="pv-glyph">···</div>
              <div>Loading providers…</div>
            </div>
          ) : visible.length === 0 ? (
            <div className="pv-empty">
              <div className="pv-glyph">∅</div>
              <div>No providers match these filters.</div>
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="pv-btn"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                >
                  Clear filters
                </button>
              </div>
            </div>
          ) : view === 'grid' ? (
            <div className="pv-grid">
              {visible.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  view={provider}
                  onOpen={handleOpen}
                />
              ))}
            </div>
          ) : (
            <ProviderTable views={visible} onOpen={handleOpen} />
          )}
        </div>

        <footer className="pv-foot">
          <span>
            Active: <b>{activeProvider?.id ?? 'none'}</b>
          </span>
          <span className="pv-sep" />
          <span>
            <b className="pv-ok">{counts.configured}</b> configured
          </span>
          <span className="pv-sep" />
          <span>
            <b>{counts.byStatus.available}</b> available to add
          </span>
          <span className="pv-grow" />
          {restartPending ? (
            <span className="pv-warn">restart pending</span>
          ) : null}
        </footer>
      </main>

      <ProviderDetailDrawer
        provider={openProvider}
        busy={deleteProvider.isPending || setActive.isPending}
        onClose={() => setOpenId(null)}
        onEdit={(target) => {
          setOpenId(null)
          openWizard(target.id)
        }}
        onDelete={(target) => void handleDelete(target)}
        onSetActive={(target) => void handleSetActive(target)}
      />

      <ProviderWizardDialog
        open={wizardOpen}
        providerId={wizardProviderId}
        views={views}
        onOpenChange={setWizardOpen}
        onSaved={() => setRestartPending(true)}
      />
    </div>
  )
}
