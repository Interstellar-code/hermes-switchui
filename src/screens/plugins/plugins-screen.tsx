'use client'

import '@/styles/matrix-skills.css'
import '@/styles/matrix-plugins.css'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PluginsHubPlugin } from '@/lib/hermes-client'
import {
  deleteAgentPlugin,
  disableAgentPlugin,
  enableAgentPlugin,
  getPluginsHub,
  installAgentPlugin,
  setPluginVisibility,
  updateAgentPlugin,
} from '@/lib/hermes-client'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import { writePluginsReviewed } from '@/screens/onboarding/lib/onboarding-storage'

const HUB_QUERY_KEY = ['plugins-hub'] as const
const RESTART_NOTICE =
  'Configuration changed. Start a new agent session or restart Hermes Dashboard before loaded tools or routes change.'

type StatusFilter = 'enabled' | 'inactive-disabled' | 'all'
type SortMode = 'name' | 'status'
type ViewMode = 'grid' | 'table'
type CategoryFilter = 'all' | 'plugins-hub' | 'internal' | 'switchui'

type PluginCategory = Exclude<CategoryFilter, 'all'>

function pluginCategory(plugin: PluginsHubPlugin): PluginCategory {
  if (plugin.name.trim().toLowerCase() === 'hermes-switch-ui') {
    return 'switchui'
  }
  return plugin.source === 'bundled' ? 'internal' : 'plugins-hub'
}

function pluginCategoryLabel(category: PluginCategory): string {
  if (category === 'switchui') return 'SwitchUI'
  if (category === 'internal') return 'Internal'
  return 'Plugins Hub'
}

function statusLabel(status: string): string {
  if (status === 'enabled') return 'Enabled'
  if (status === 'inactive') return 'Inactive'
  if (status === 'disabled') return 'Disabled'
  return 'Unknown'
}

function statusClass(status: string): string {
  if (status === 'enabled') return 'active'
  if (status === 'inactive' || status === 'disabled') return 'disabled'
  return 'unknown'
}

function statusRank(status: string): number {
  if (status === 'enabled') return 0
  if (status === 'inactive') return 1
  if (status === 'disabled') return 2
  return 3
}

function isInactiveOrDisabled(status: string): boolean {
  return status === 'inactive' || status === 'disabled'
}

function installResultNotice(result: unknown): string {
  const value = result as { warnings?: unknown; missing_env?: unknown } | null
  const hasWarnings =
    Array.isArray(value?.warnings) && value.warnings.length > 0
  const hasMissingEnv =
    Array.isArray(value?.missing_env) && value.missing_env.length > 0
  const setupNote = [
    hasWarnings
      ? ' Hermes reported setup warnings; review Hermes Dashboard logs.'
      : '',
    hasMissingEnv
      ? ' Some required environment variables are missing; configure them in Hermes before activation.'
      : '',
  ].join('')
  return `Plugin installed.${setupNote} Activate third-party plugins in Hermes CLI: hermes plugins enable <plugin>.`
}

type PluginActionsProps = {
  plugin: PluginsHubPlugin
  pending: boolean
  onEnable: (name: string) => void
  onDisable: (name: string) => void
  onUpdate: (name: string) => void
  onDelete: (plugin: PluginsHubPlugin) => void
  onVisibility: (name: string, hidden: boolean) => void
}

function PluginActions({
  plugin,
  pending,
  onEnable,
  onDisable,
  onUpdate,
  onDelete,
  onVisibility,
}: PluginActionsProps) {
  const bundled = plugin.source === 'bundled'
  const knownState =
    plugin.runtimeStatus === 'enabled' ||
    isInactiveOrDisabled(plugin.runtimeStatus)
  const inactive = isInactiveOrDisabled(plugin.runtimeStatus)
  const showCliHandoff = !bundled && plugin.runtimeStatus !== 'enabled'

  return (
    <>
      <div className="pl-actions">
        {plugin.runtimeStatus === 'enabled' && (
          <button
            type="button"
            onClick={() => onDisable(plugin.name)}
            disabled={pending}
          >
            Disable
          </button>
        )}
        {bundled && inactive && (
          <button
            type="button"
            onClick={() => onEnable(plugin.name)}
            disabled={pending}
          >
            Enable
          </button>
        )}
        {knownState && plugin.canUpdateGit && (
          <button
            type="button"
            onClick={() => onUpdate(plugin.name)}
            disabled={pending}
          >
            Update
          </button>
        )}
        {plugin.hasDashboardManifest && (
          <button
            type="button"
            onClick={() => onVisibility(plugin.name, !plugin.userHidden)}
            disabled={pending}
          >
            {plugin.userHidden ? 'Show in Dashboard' : 'Hide in Dashboard'}
          </button>
        )}
        {knownState && plugin.canRemove && (
          <button
            type="button"
            className="pl-danger"
            onClick={() => onDelete(plugin)}
            disabled={pending}
          >
            Remove
          </button>
        )}
      </div>
      {showCliHandoff && (
        <p className="pl-cli">
          Activate in Hermes CLI:{' '}
          <code>{`hermes plugins enable ${plugin.name}`}</code>
        </p>
      )}
    </>
  )
}

function PluginMetadata({ plugin }: { plugin: PluginsHubPlugin }) {
  const manifest = plugin.dashboardManifest
  const category = pluginCategory(plugin)
  return (
    <>
      <div className="sk-card-tags">
        <span className="sk-tag cat">{pluginCategoryLabel(category)}</span>
        <span className="sk-tag origin">
          {plugin.source || 'unknown source'}
        </span>
        {plugin.hasDashboardManifest && (
          <span className="sk-tag origin">Dashboard</span>
        )}
        {manifest?.label && (
          <span className="sk-tag origin">{manifest.label}</span>
        )}
        {manifest?.hasApi && <span className="sk-tag origin">API</span>}
        {manifest?.hasTab && <span className="sk-tag origin">Tab</span>}
        {plugin.userHidden && (
          <span className="sk-tag builtin">Dashboard hidden</span>
        )}
      </div>
      {plugin.authRequired && (
        <p className="pl-auth">
          Authentication required
          {plugin.authCommand ? (
            <>
              : <code>{plugin.authCommand}</code>
            </>
          ) : (
            ''
          )}
        </p>
      )}
    </>
  )
}

export function PluginsScreen() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PluginsHubPlugin | null>(
    null,
  )
  const [installIdentifier, setInstallIdentifier] = useState('')
  const [installConfirmOpen, setInstallConfirmOpen] = useState(false)
  const [restartNotice, setRestartNotice] = useState<string | null>(null)
  const [installNotice, setInstallNotice] = useState<string | null>(null)

  const hubQuery = useQuery({
    queryKey: HUB_QUERY_KEY,
    queryFn: getPluginsHub,
    refetchInterval: 30_000,
  })

  // Settle the onboarding checklist's "Review core plugins" step — but only
  // once the catalogue is actually on screen. Mounting the route is not a
  // review if the hub never answered: the user would have been looking at an
  // error, and recording that as "reviewed" would retire the step on exactly
  // the installs that most need it. Keyed off real data, so a failed or
  // still-loading hub records nothing.
  const hubLoaded = hubQuery.isSuccess
  useEffect(() => {
    if (!hubLoaded) return
    let storage: Storage | null = null
    try {
      // The property access itself throws in some private-browsing modes,
      // which is why this is not folded into `writePluginsReviewed`.
      storage = typeof window === 'undefined' ? null : window.localStorage
    } catch {
      storage = null
    }
    writePluginsReviewed(storage)
  }, [hubLoaded])

  const refreshHub = () =>
    queryClient.invalidateQueries({ queryKey: HUB_QUERY_KEY })

  const enableMutation = useMutation({
    mutationFn: enableAgentPlugin,
    onSuccess: () => {
      setRestartNotice(RESTART_NOTICE)
      void refreshHub()
    },
    onError: () =>
      toast('Unable to enable plugin. Check Hermes Dashboard logs.', {
        type: 'error',
      }),
  })
  const disableMutation = useMutation({
    mutationFn: disableAgentPlugin,
    onSuccess: () => {
      setRestartNotice(RESTART_NOTICE)
      void refreshHub()
    },
    onError: () =>
      toast('Unable to disable plugin. Check Hermes Dashboard logs.', {
        type: 'error',
      }),
  })
  const updateMutation = useMutation({
    mutationFn: updateAgentPlugin,
    onSuccess: () => {
      setRestartNotice(RESTART_NOTICE)
      void refreshHub()
    },
    onError: () =>
      toast('Unable to update plugin. Check Hermes Dashboard logs.', {
        type: 'error',
      }),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteAgentPlugin,
    onSuccess: () => {
      setRestartNotice(RESTART_NOTICE)
      void refreshHub()
    },
    onError: () =>
      toast('Unable to remove plugin. Check Hermes Dashboard logs.', {
        type: 'error',
      }),
  })
  const visibilityMutation = useMutation({
    mutationFn: ({ name, hidden }: { name: string; hidden: boolean }) =>
      setPluginVisibility(name, hidden),
    onSuccess: () => {
      void refreshHub()
    },
    onError: () =>
      toast(
        'Unable to update Dashboard visibility. Check Hermes Dashboard logs.',
        {
          type: 'error',
        },
      ),
  })
  const installMutation = useMutation({
    mutationFn: installAgentPlugin,
    onSuccess: (result) => {
      setInstallIdentifier('')
      setInstallNotice(installResultNotice(result))
      setRestartNotice(RESTART_NOTICE)
      void refreshHub()
    },
    onError: () =>
      toast('Unable to install plugin. Check Hermes Dashboard logs.', {
        type: 'error',
      }),
  })

  const plugins = hubQuery.data?.plugins ?? []
  const counts = useMemo(
    () => ({
      enabled: plugins.filter((plugin) => plugin.runtimeStatus === 'enabled')
        .length,
      inactiveDisabled: plugins.filter((plugin) =>
        isInactiveOrDisabled(plugin.runtimeStatus),
      ).length,
      pluginsHub: plugins.filter(
        (plugin) => pluginCategory(plugin) === 'plugins-hub',
      ).length,
      internal: plugins.filter(
        (plugin) => pluginCategory(plugin) === 'internal',
      ).length,
      switchui: plugins.filter(
        (plugin) => pluginCategory(plugin) === 'switchui',
      ).length,
    }),
    [plugins],
  )
  const visiblePlugins = useMemo(() => {
    const term = search.trim().toLowerCase()
    return plugins
      .filter((plugin) => {
        if (statusFilter === 'enabled' && plugin.runtimeStatus !== 'enabled')
          return false
        if (
          statusFilter === 'inactive-disabled' &&
          !isInactiveOrDisabled(plugin.runtimeStatus)
        ) {
          return false
        }
        if (
          categoryFilter !== 'all' &&
          pluginCategory(plugin) !== categoryFilter
        ) {
          return false
        }
        if (!term) return true
        return [
          plugin.name,
          plugin.description,
          plugin.source,
          plugin.dashboardManifest?.label ?? '',
        ].some((field) => field.toLowerCase().includes(term))
      })
      .sort((a, b) => {
        if (sortMode === 'status') {
          const byStatus =
            statusRank(a.runtimeStatus) - statusRank(b.runtimeStatus)
          if (byStatus) return byStatus
        }
        return a.name.localeCompare(b.name)
      })
  }, [categoryFilter, plugins, search, sortMode, statusFilter])

  const mutationPending =
    enableMutation.isPending ||
    disableMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    visibilityMutation.isPending ||
    installMutation.isPending

  const actionProps = {
    pending: mutationPending,
    onEnable: (name: string) => enableMutation.mutate(name),
    onDisable: (name: string) => disableMutation.mutate(name),
    onUpdate: (name: string) => updateMutation.mutate(name),
    onDelete: setDeleteTarget,
    onVisibility: (name: string, hidden: boolean) =>
      visibilityMutation.mutate({ name, hidden }),
  }

  return (
    <div
      className="h-screen bg-surface text-ink sk-shell"
      data-screen="plugins"
    >
      <aside className={cn('sk-filter', filtersCollapsed && 'collapsed')}>
        <div className="sk-filter-hdr">
          <h2>Plugins</h2>
          <span className="ct">{plugins.length}</span>
          <button
            type="button"
            onClick={() => setFiltersCollapsed((value) => !value)}
            title={filtersCollapsed ? 'Expand filters' : 'Collapse filters'}
            aria-label={
              filtersCollapsed ? 'Expand filters' : 'Collapse filters'
            }
            className="collapse-btn"
          >
            {filtersCollapsed ? '›' : '‹'}
          </button>
        </div>
        <div className="sk-filter-search">
          <input
            aria-label="Search plugins"
            value={search}
            placeholder="Search plugins…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="sk-filter-body">
          <div className="sk-filter-section">
            <div className="sec-label">Runtime state</div>
            <div className="sk-segment">
              <button
                type="button"
                className={cn(statusFilter === 'enabled' && 'active')}
                onClick={() => setStatusFilter('enabled')}
              >
                Enabled <span>{counts.enabled}</span>
              </button>
              <button
                type="button"
                className={cn(statusFilter === 'inactive-disabled' && 'active')}
                onClick={() => setStatusFilter('inactive-disabled')}
              >
                Inactive / disabled <span>{counts.inactiveDisabled}</span>
              </button>
              <button
                type="button"
                className={cn(statusFilter === 'all' && 'active')}
                onClick={() => setStatusFilter('all')}
              >
                All <span>{plugins.length}</span>
              </button>
            </div>
          </div>
          <div className="sk-filter-section">
            <div className="sec-label">Category</div>
            <div className="sk-filter-list">
              <button
                type="button"
                aria-label={`Plugins Hub ${counts.pluginsHub}`}
                className={cn(
                  'sk-filter-item',
                  categoryFilter === 'plugins-hub' && 'active',
                )}
                onClick={() => setCategoryFilter('plugins-hub')}
              >
                <span>Plugins Hub</span>
                <span className="item-ct">{counts.pluginsHub}</span>
              </button>
              <button
                type="button"
                aria-label={`Internal ${counts.internal}`}
                className={cn(
                  'sk-filter-item',
                  categoryFilter === 'internal' && 'active',
                )}
                onClick={() => setCategoryFilter('internal')}
              >
                <span>Internal</span>
                <span className="item-ct">{counts.internal}</span>
              </button>
              <button
                type="button"
                aria-label={`SwitchUI ${counts.switchui}`}
                className={cn(
                  'sk-filter-item',
                  categoryFilter === 'switchui' && 'active',
                )}
                onClick={() => setCategoryFilter('switchui')}
              >
                <span>SwitchUI</span>
                <span className="item-ct">{counts.switchui}</span>
              </button>
              <button
                type="button"
                aria-label={`All categories ${plugins.length}`}
                className={cn(
                  'sk-filter-item',
                  categoryFilter === 'all' && 'active',
                )}
                onClick={() => setCategoryFilter('all')}
              >
                <span>All categories</span>
                <span className="item-ct">{plugins.length}</span>
              </button>
            </div>
          </div>
        </div>
        <div className="sk-rail">
          <span className="rail-label">Plugins</span>
          <span className="rail-badge">{plugins.length}</span>
        </div>
      </aside>

      <div className="sk-main">
        <div className="sk-top">
          <div className="crumbs">
            <div className="title-group">
              <h1>Plugins</h1>
              <span className="sub">Workspace / Settings / Plugins</span>
            </div>
          </div>
          <div className="meta">
            <div className="stat">
              <span className="v ok">{counts.enabled}</span>
              <span className="l">Enabled</span>
            </div>
            <div className="stat">
              <span className="v">{plugins.length}</span>
              <span className="l">Hub rows</span>
            </div>
          </div>
        </div>

        <form
          className="pl-install"
          onSubmit={(event) => {
            event.preventDefault()
            if (installIdentifier.trim()) setInstallConfirmOpen(true)
          }}
        >
          <input
            aria-label="Plugin identifier"
            value={installIdentifier}
            onChange={(event) => setInstallIdentifier(event.target.value)}
            placeholder="Plugin identifier"
            disabled={installMutation.isPending}
          />
          <button
            type="submit"
            disabled={!installIdentifier.trim() || installMutation.isPending}
          >
            Install plugin
          </button>
        </form>
        {restartNotice && (
          <p className="pl-notice" role="status">
            {restartNotice}
          </p>
        )}
        {installNotice && (
          <p className="pl-notice" role="status">
            {installNotice}
          </p>
        )}

        <div className="sk-toolbar">
          <span className="result-ct">
            {visiblePlugins.length} of {plugins.length} plugins
          </span>
          <div className="toolbar-right">
            <select
              aria-label="Sort plugins"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
            >
              <option value="name">Sort: Name</option>
              <option value="status">Sort: Status</option>
            </select>
            <div className="sk-view-toggle" aria-label="Plugins view">
              <button
                type="button"
                aria-label="Grid view"
                className={cn(viewMode === 'grid' && 'active')}
                onClick={() => setViewMode('grid')}
              >
                ▦
              </button>
              <button
                type="button"
                aria-label="Table view"
                className={cn(viewMode === 'table' && 'active')}
                onClick={() => setViewMode('table')}
              >
                ☷
              </button>
            </div>
          </div>
        </div>

        <div className="sk-canvas">
          {hubQuery.isLoading && (
            <div className="sk-grid" aria-label="Loading plugins">
              <div className="sk-skeleton" />
              <div className="sk-skeleton" />
              <div className="sk-skeleton" />
            </div>
          )}
          {hubQuery.isError && (
            <div className="sk-empty">
              <div className="empty-icon">⌁</div>
              <h3>Plugins Hub is unavailable</h3>
              <p>Check Hermes Dashboard and try again.</p>
            </div>
          )}
          {!hubQuery.isLoading &&
            !hubQuery.isError &&
            visiblePlugins.length === 0 && (
              <div className="sk-empty">
                <div className="empty-icon">⌁</div>
                <h3>No matching plugins</h3>
                <p>Try a different search or runtime-state filter.</p>
              </div>
            )}
          {!hubQuery.isLoading &&
            !hubQuery.isError &&
            visiblePlugins.length > 0 &&
            viewMode === 'grid' && (
              <div className="sk-grid">
                {visiblePlugins.map((plugin) => (
                  <article
                    key={plugin.name}
                    className="sk-card"
                    style={
                      {
                        '--card-accent':
                          plugin.runtimeStatus === 'enabled'
                            ? 'var(--m-green-500, #00ff41)'
                            : 'var(--m-text-ghost, #555)',
                      } as React.CSSProperties
                    }
                  >
                    <div className="sk-card-body">
                      <div className="sk-glyph">
                        {plugin.name.slice(0, 2).toUpperCase() || 'PL'}
                      </div>
                      <div className="sk-card-info">
                        <p className="name">{plugin.name}</p>
                        <p className="author">
                          {plugin.version || 'Version unavailable'}
                        </p>
                      </div>
                    </div>
                    <p className="sk-card-desc">
                      {plugin.description || 'No description provided.'}
                    </p>
                    <PluginMetadata plugin={plugin} />
                    <div className="sk-card-meta">
                      <div className="meta-left">
                        <span
                          className={`sk-status-pill ${statusClass(plugin.runtimeStatus)}`}
                        >
                          <span className="dot" />
                          {statusLabel(plugin.runtimeStatus)}
                        </span>
                      </div>
                    </div>
                    <PluginActions plugin={plugin} {...actionProps} />
                  </article>
                ))}
              </div>
            )}
          {!hubQuery.isLoading &&
            !hubQuery.isError &&
            visiblePlugins.length > 0 &&
            viewMode === 'table' && (
              <table className="sk-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Dashboard</th>
                    <th>Authentication</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePlugins.map((plugin) => (
                    <tr key={plugin.name}>
                      <td>
                        <strong>{plugin.name}</strong>
                        <span className="pl-table-detail">
                          {plugin.version || 'Version unavailable'} ·{' '}
                          {plugin.description || 'No description provided.'}
                        </span>
                      </td>
                      <td>{pluginCategoryLabel(pluginCategory(plugin))}</td>
                      <td>{plugin.source || 'Unknown'}</td>
                      <td>
                        <span
                          className={`sk-status-pill ${statusClass(plugin.runtimeStatus)}`}
                        >
                          <span className="dot" />
                          {statusLabel(plugin.runtimeStatus)}
                        </span>
                      </td>
                      <td>
                        {plugin.hasDashboardManifest
                          ? [
                              plugin.dashboardManifest?.label,
                              plugin.dashboardManifest?.hasApi ? 'API' : '',
                              plugin.dashboardManifest?.hasTab ? 'Tab' : '',
                              plugin.userHidden ? 'Hidden' : '',
                            ]
                              .filter(Boolean)
                              .join(' · ') || 'Available'
                          : '—'}
                      </td>
                      <td>
                        {plugin.authRequired
                          ? `Required${plugin.authCommand ? ` · ${plugin.authCommand}` : ''}`
                          : '—'}
                      </td>
                      <td>
                        <PluginActions plugin={plugin} {...actionProps} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>

      <ConfirmDialog
        open={installConfirmOpen}
        title="Install plugin?"
        message="Install the entered plugin identifier with activation disabled?"
        confirmLabel="Install"
        onConfirm={() => {
          setInstallConfirmOpen(false)
          installMutation.mutate({ identifier: installIdentifier.trim() })
        }}
        onCancel={() => setInstallConfirmOpen(false)}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Remove plugin?"
        message="Remove this plugin from Hermes? This cannot be undone."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.name)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
