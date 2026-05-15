'use client'

import '@/styles/matrix-mcp.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useMcpCapabilityMode } from './hooks/use-mcp-capability-mode'
import { useMcpHub } from './hooks/use-mcp-hub'
import { useMcpServers } from './hooks/use-mcp-servers'
import { McpDetailDrawer } from './mcp-detail-drawer'
import { McpServerDialog } from './components/mcp-server-dialog'
import { InstallConfirmationDialog } from './components/install-confirmation-dialog'
import { SourcesManagerDialog } from './components/sources-manager-dialog'
import type { McpClientInput, McpServer } from '@/types/mcp'
import type { HubMcpEntry } from './hooks/use-mcp-hub'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { Ico, serverInitials } from './icons'

/* ── types ── */
export type McpServerView = {
  id: string
  endpoint: string
  transport: string
  auth: string
  status: string
  tools: number
  latency: number | null
  cmd: string
  args?: Array<string>
  source: string
  enabled: boolean
  installed: boolean
  desc?: string
  /** discovered tools from McpServer, if available */
  discoveredTools?: Array<{ name: string; description?: string }>
}

type StatusFilter = 'installed' | 'connected' | 'market' | 'all'
type TransportFilter = 'all' | 'stdio' | 'http' | 'sse'
type AuthFilter = 'all' | 'none' | 'bearer' | 'oauth'
type ViewMode = 'grid' | 'table'
type SortMode = 'status' | 'name' | 'tools'

/* ── helpers ── */
function endpointDisplay(s: McpServer): string {
  if (s.transportType === 'stdio') {
    return [s.command, ...s.args].filter(Boolean).join(' ') || s.id
  }
  return s.url || s.id
}

function endpointScheme(server: McpServerView): string {
  if (server.transport === 'stdio') return '$ '
  if (server.endpoint.startsWith('https://')) return 'https://'
  if (server.endpoint.startsWith('http://')) return 'http://'
  return ''
}

function endpointBody(server: McpServerView): string {
  return server.transport === 'stdio'
    ? server.endpoint
    : server.endpoint.replace(/^https?:\/\//, '')
}

function toolsLabel(tools: number): string {
  return tools > 0 ? `${tools} tools` : 'awaiting probe'
}

/** Map McpServer from API to our internal view model */
function toView(s: McpServer): McpServerView {
  const transport = s.transportType
  const auth = s.authType
  const endpoint = endpointDisplay(s)
  const status = s.status === 'connected' ? 'connected'
    : s.status === 'failed' ? 'error'
    : 'unknown'
  const cmd = s.command || ''

  return {
    id: s.id,
    endpoint,
    transport,
    auth,
    status,
    tools: s.discoveredToolsCount,
    latency: null,
    cmd,
    args: s.args,
    // source distinction not yet wired; all configured servers use config.yaml
    source: 'config.yaml',
    enabled: s.enabled,
    installed: true,
    discoveredTools: s.discoveredTools.map((t) => ({ name: t.name, description: t.description })),
  }
}

/** Map HubMcpEntry to our internal view model */
function hubToView(e: HubMcpEntry): McpServerView {
  return {
    id: e.id,
    endpoint: e.source,
    transport: 'http',
    auth: 'none',
    status: 'market',
    tools: 0,
    latency: null,
    cmd: '',
    source: 'marketplace',
    enabled: false,
    installed: false,
    desc: e.description || '',
  }
}

function statusPillClass(status: string): string {
  if (status === 'connected') return 'mcp-ok'
  if (status === 'error') return 'mcp-err'
  if (status === 'market') return 'mcp-market-pill'
  return 'mcp-unknown'
}

function sortLabel(s: SortMode): string {
  if (s === 'status') return 'connected first'
  if (s === 'name') return 'name a-z'
  return 'most tools'
}

/* ── main component ── */
export function McpScreen() {
  const queryClient = useQueryClient()

  /* filter state */
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('installed')
  const [transportFilter, setTransportFilter] = useState<TransportFilter>('all')
  const [authFilter, setAuthFilter] = useState<AuthFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sortMode, setSortMode] = useState<SortMode>('status')
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)
  const [showBanner, setShowBanner] = useState(true)

  /* detail drawer */
  const [activeServer, setActiveServer] = useState<McpServerView | null>(null)

  /* dialog state (existing) */
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<McpServer | McpClientInput | null>(null)
  const [installEntry, setInstallEntry] = useState<HubMcpEntry | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)

  /* data hooks */
  const { mode: capabilityMode } = useMcpCapabilityMode()
  const serverQuery = useMcpServers({ tab: 'all', category: 'All', search: '' })
  const hubQuery = useMcpHub(statusFilter === 'market' ? search : '')

  /* build unified server list */
  const allServers = useMemo<Array<McpServerView>>(() => {
    const configured = (serverQuery.data?.servers ?? []).map(toView)
    const market = (hubQuery.data?.results ?? []).map(hubToView)
    // Deduplicate by id (configured takes priority)
    const seen = new Set(configured.map((s) => s.id))
    const uniqueMarket = market.filter((m) => !seen.has(m.id))
    return [...configured, ...uniqueMarket]
  }, [serverQuery.data, hubQuery.data])

  /* filtered + sorted list */
  const filteredList = useMemo(() => {
    let list = allServers.filter((s) => {
      if (statusFilter === 'installed' && !s.installed) return false
      if (statusFilter === 'connected' && s.status !== 'connected') return false
      if (statusFilter === 'market' && s.status !== 'market') return false
      if (transportFilter !== 'all' && s.transport !== transportFilter) return false
      if (authFilter !== 'all' && s.auth !== authFilter) return false
      if (search) {
        const t = search.toLowerCase()
        if (
          !s.id.toLowerCase().includes(t) &&
          !s.endpoint.toLowerCase().includes(t) &&
          !(s.desc || '').toLowerCase().includes(t)
        )
          return false
      }
      return true
    })

    if (sortMode === 'name') {
      list = [...list].sort((a, b) => a.id.localeCompare(b.id))
    } else if (sortMode === 'status') {
      list = [...list].sort(
        (a, b) =>
          (a.status === 'connected' ? 0 : 1) - (b.status === 'connected' ? 0 : 1) ||
          a.id.localeCompare(b.id),
      )
    } else {
      list = [...list].sort((a, b) => b.tools - a.tools)
    }
    return list
  }, [allServers, statusFilter, transportFilter, authFilter, search, sortMode])

  /* counts */
  const totalCount = allServers.length
  const connectedCount = allServers.filter((s) => s.status === 'connected').length
  const installedCount = allServers.filter((s) => s.installed).length
  const marketCount = allServers.filter((s) => s.status === 'market').length

  const resetFilters = useCallback(() => {
    setSearch('')
    setStatusFilter('installed')
    setTransportFilter('all')
    setAuthFilter('all')
  }, [])

  /* toggle handler */
  const handleToggle = useCallback(
    (s: McpServerView) => {
      // TODO: wire to API mutation
      if (activeServer?.id === s.id) {
        setActiveServer((prev) => (prev ? { ...prev, enabled: !prev.enabled } : null))
      }
      toast(s.enabled ? `${s.id} disabled` : `${s.id} enabled`, { type: 'info' })
    },
    [activeServer],
  )

  /* cycle sort */
  const cycleSort = useCallback(() => {
    setSortMode((s) => (s === 'status' ? 'name' : s === 'name' ? 'tools' : 'status'))
  }, [])

  return (
    <div
      className={cn(
        'mcp-shell',
        filtersCollapsed && 'mcp-filters-collapsed',
      )}
      data-screen="mcp"
    >
      {/* Column 1: Filter panel */}
      {filtersCollapsed ? (
        <aside className="mcp-filter is-collapsed">
          <div className="mcp-filter-hdr" style={{ justifyContent: 'center' }}>
            <button
              type="button"
              className="mcp-ico-btn"
              onClick={() => setFiltersCollapsed(false)}
              title="Expand filters"
            >
              {Ico.unfold}
            </button>
          </div>
          <div className="mcp-filter-rail">
            <span className="mcp-badge-n">{filteredList.length}</span>
            <span className="mcp-vlabel">Filters</span>
          </div>
          <div className="mcp-filter-foot">
            <button
              type="button"
              className="mcp-btn mcp-btn-sm mcp-btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}
              onClick={() => setDialogOpen(true)}
            >
              {Ico.plus}
            </button>
          </div>
        </aside>
      ) : (
        <aside className="mcp-filter">
          <div className="mcp-filter-hdr">
            <h3>Filters</h3>
            <span className="mcp-ct">{filteredList.length}</span>
            <span className="mcp-actions">
              <button
                type="button"
                className="mcp-ico-btn"
                onClick={resetFilters}
                title="Reset filters"
              >
                {Ico.refresh}
              </button>
              <button
                type="button"
                className="mcp-ico-btn"
                onClick={() => setFiltersCollapsed(true)}
                title="Collapse filters"
              >
                {Ico.fold}
              </button>
            </span>
          </div>

          <div className="mcp-filter-search">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px' }}>
              {Ico.search}
              <input
                placeholder="search servers…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="mcp-filter-body">
            {/* Status */}
            <div className="mcp-filter-grp">
              <h4>Status</h4>
              <div className="mcp-seg-stack">
                {(
                  [
                    { id: 'installed', label: 'Installed' },
                    { id: 'connected', label: 'Connected' },
                    { id: 'market', label: 'Marketplace' },
                    { id: 'all', label: 'All' },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={cn(statusFilter === o.id && 'on')}
                    onClick={() => setStatusFilter(o.id)}
                  >
                    {o.label}
                    <span className="mcp-ct">
                      {o.id === 'installed'
                        ? installedCount
                        : o.id === 'connected'
                          ? connectedCount
                          : o.id === 'market'
                            ? marketCount
                            : totalCount}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Transport */}
            <div className="mcp-filter-grp">
              <h4>Transport</h4>
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'stdio', label: 'stdio' },
                  { id: 'http', label: 'http' },
                  { id: 'sse', label: 'sse' },
                ] as const
              ).map((o) => (
                <div
                  key={o.id}
                  className={cn('mcp-opt-row', transportFilter === o.id && 'on')}
                  onClick={() => setTransportFilter(o.id)}
                >
                  <span className="mcp-dot" />
                  {o.label}
                  <span className="mcp-ct">
                    {o.id === 'all' ? totalCount : allServers.filter((s) => s.transport === o.id).length}
                  </span>
                </div>
              ))}
            </div>

            {/* Auth */}
            <div className="mcp-filter-grp">
              <h4>Auth</h4>
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'none', label: 'None' },
                  { id: 'bearer', label: 'Bearer' },
                  { id: 'oauth', label: 'OAuth' },
                ] as const
              ).map((o) => (
                <div
                  key={o.id}
                  className={cn('mcp-opt-row', authFilter === o.id && 'on')}
                  onClick={() => setAuthFilter(o.id)}
                >
                  <span className="mcp-dot" />
                  {o.label}
                  <span className="mcp-ct">
                    {o.id === 'all' ? totalCount : allServers.filter((s) => s.auth === o.id).length}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mcp-filter-foot">
            <button
              type="button"
              className="mcp-btn mcp-btn-sm mcp-btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}
              onClick={() => setDialogOpen(true)}
            >
              {Ico.plus} Add Server
            </button>
            <span
              style={{
                font: '500 10px var(--m-font-mono, ui-monospace, monospace)',
                color: 'var(--m-text-faint, #3a5a4a)',
                textAlign: 'center',
                textTransform: 'uppercase',
                letterSpacing: '.18em',
              }}
            >
              {capabilityMode === 'fallback' ? 'config.yaml fallback' : 'native mode'}
            </span>
          </div>
        </aside>
      )}

      {/* Column 2: Main content */}
      <main className="mcp-main">
        {/* Top header */}
        <div className="mcp-top">
          <div>
            <div className="mcp-crumbs">
              Hermes Switch UI<span className="mcp-sep">·</span>MCP
            </div>
            <h1>MCP Servers</h1>
            <div className="mcp-sub">
              Discover, install, and manage Model Context Protocol servers exposed to Hermes Agent.
            </div>
          </div>
          <div className="mcp-right">
            <div className="mcp-stat">
              <span>Installed</span>
              <b>{installedCount}</b>
            </div>
            <div className="mcp-stat">
              <span>Connected</span>
              <b style={{ color: 'var(--m-green-500, #00ff41)' }}>{connectedCount}</b>
            </div>
            <div className="mcp-stat">
              <span>Marketplace</span>
              <b style={{ color: '#5fcfff', textShadow: '0 0 6px rgba(95,207,255,.4)' }}>{marketCount}</b>
            </div>
            <button
              type="button"
              className="mcp-btn mcp-btn-primary"
              style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => setDialogOpen(true)}
            >
              {Ico.plus} Add Server
            </button>
          </div>
        </div>

        {/* Banner (fallback mode) */}
        {showBanner && capabilityMode === 'fallback' && (
          <div className="mcp-banner">
            <span className="mcp-ic">{Ico.warn}</span>
            <span className="mcp-grow">
              Local fallback mode — using config.yaml. Test, Discover, and Logs require the new{' '}
              <code style={{ color: '#ffd9a0' }}>hermes-agent /api/mcp</code> endpoints.
            </span>
            <span className="mcp-x" onClick={() => setShowBanner(false)}>
              {Ico.x}
            </span>
          </div>
        )}

        {/* Toolbar */}
        <div className="mcp-toolbar">
          <span
            style={{
              font: '500 11px var(--m-font-mono, ui-monospace, monospace)',
              color: 'var(--m-text-faint, #3a5a4a)',
              textTransform: 'uppercase',
              letterSpacing: '.18em',
            }}
          >
            {filteredList.length} of {totalCount}
          </span>
          <span className="mcp-grow" />
          <span className="mcp-sort" onClick={cycleSort}>
            sort · {sortLabel(sortMode)}
          </span>
          <div className="mcp-view-toggle" role="tablist">
            <button
              type="button"
              className={cn(viewMode === 'grid' && 'on')}
              onClick={() => setViewMode('grid')}
            >
              {Ico.grid}<span>grid</span>
            </button>
            <button
              type="button"
              className={cn(viewMode === 'table' && 'on')}
              onClick={() => setViewMode('table')}
            >
              {Ico.rows}<span>table</span>
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="mcp-canvas">
          {filteredList.length === 0 ? (
            <div className="mcp-empty">
              <div className="mcp-glyph">∅</div>
              no servers match.
              <br />
              <span style={{ color: 'var(--m-text-muted, #6a9a7a)' }}>
                try clearing filters or switching to marketplace.
              </span>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="mcp-grid">
              {filteredList.map((s) => (
                <ServerCard
                  key={s.id}
                  server={s}
                  onOpen={setActiveServer}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          ) : (
            <ServerTable
              list={filteredList}
              onOpen={setActiveServer}
              onToggle={handleToggle}
            />
          )}
        </div>

        {/* Footer status bar */}
        <footer className="mcp-foot">
          <span><b>{totalCount}</b> servers</span>
          <span className="mcp-sep" />
          <span><b className="mcp-ok">{connectedCount}</b> connected</span>
          <span className="mcp-sep" />
          <span>mode <b>{capabilityMode === 'fallback' ? 'config fallback' : 'native'}</b></span>
          <span className="mcp-foot-updated">updated <b>now</b></span>
        </footer>
      </main>

      {/* Detail Drawer */}
      <McpDetailDrawer
        server={activeServer}
        onClose={() => setActiveServer(null)}
        onToggle={handleToggle}
      />

      {/* Existing dialogs (preserved) */}
      <McpServerDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => {
          setDialogOpen(false)
          setEditing(null)
        }}
      />

      <InstallConfirmationDialog
        entry={installEntry}
        onClose={() => setInstallEntry(null)}
        onInstalled={() => {
          queryClient.invalidateQueries({ queryKey: ['mcp', 'servers'] })
          queryClient.invalidateQueries({ queryKey: ['mcp', 'hub-search'] })
        }}
      />

      <SourcesManagerDialog
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
      />
    </div>
  )
}

/* ── Grid Card ── */
function ServerCard({
  server,
  onOpen,
  onToggle,
}: {
  server: McpServerView
  onOpen: (s: McpServerView) => void
  onToggle: (s: McpServerView) => void
}) {
  const ini = serverInitials(server.id)
  const cls =
    server.status === 'connected'
      ? 'mcp-connected'
      : server.status === 'market'
        ? 'mcp-market'
        : ''

  return (
    <div className={cn('mcp-card', cls)} onClick={() => onOpen(server)}>
      <div className="mcp-hd">
        <div className="mcp-glyph">{ini}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="mcp-name">{server.id}</div>
          <div className="mcp-by">{server.source || 'config.yaml'}</div>
        </div>
        <div className="mcp-right">
          <span className={cn('mcp-status-pill', statusPillClass(server.status))}>
            <span className="mcp-d" />
            {server.status === 'market' ? 'marketplace' : server.status}
          </span>
        </div>
      </div>
      <div className="mcp-endpoint">
        <span className="mcp-scheme">{endpointScheme(server)}</span>
        {endpointBody(server)}
      </div>
      <div className="mcp-kvgrid">
        <div className="mcp-kv">
          <span className="mcp-lbl">Tools</span>
          <b className={server.tools > 0 ? 'mcp-live' : 'mcp-zero'}>{toolsLabel(server.tools)}</b>
        </div>
        <div className="mcp-kv">
          <span className="mcp-lbl">Auth</span>
          <b>{server.auth}</b>
        </div>
      </div>
      <div className="mcp-bd">
        <span className="mcp-tag mcp-transport">{server.transport}</span>
        <span className={cn('mcp-tag mcp-auth', server.auth === 'none' && 'mcp-none')}>auth: {server.auth}</span>
        {server.status === 'connected' && <span className="mcp-tag mcp-online">online</span>}
        {server.status === 'market' && <span className="mcp-tag mcp-install-tag">install</span>}
      </div>
      <div className="mcp-ft">
        {server.status === 'market' ? (
          <>
            <button
              type="button"
              className="mcp-btn-mini"
              style={{ color: 'var(--m-green-500, #00ff41)', borderColor: 'var(--m-border, #1a2a22)' }}
              onClick={(e) => {
                e.stopPropagation()
                onToggle(server)
              }}
            >
              Install
            </button>
          </>
        ) : (
          <button
            type="button"
            className="mcp-btn-mini"
            onClick={(e) => {
              e.stopPropagation()
              onOpen(server)
            }}
          >
            Inspect
          </button>
        )}
        <span className="mcp-grow" />
        <span
          className={cn('mcp-switch', server.enabled && 'on')}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(server)
          }}
          title={server.enabled ? 'Disable' : 'Enable'}
        />
      </div>
    </div>
  )
}

/* ── Table View ── */
function ServerTable({
  list,
  onOpen,
  onToggle,
}: {
  list: Array<McpServerView>
  onOpen: (s: McpServerView) => void
  onToggle: (s: McpServerView) => void
}) {
  return (
    <table className="mcp-table">
      <thead>
        <tr>
          <th style={{ width: '22%' }}>Server</th>
          <th>Endpoint</th>
          <th>Transport</th>
          <th>Auth</th>
          <th>Tools</th>
          <th>Status</th>
          <th style={{ textAlign: 'right' }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {list.map((s) => {
          const ini = serverInitials(s.id)
          return (
            <tr key={s.id} onClick={() => onOpen(s)}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="mcp-glyph" style={{ width: 24, height: 24, fontSize: 10 }}>
                    {ini}
                  </div>
                  <span>{s.id}</span>
                </div>
              </td>
              <td className="mcp-endpoint-cell">{s.endpoint}</td>
              <td>{s.transport}</td>
              <td>{s.auth}</td>
              <td>{toolsLabel(s.tools)}</td>
              <td>
                <span className={cn('mcp-status-pill', statusPillClass(s.status))}>
                  <span className="mcp-d" />
                  {s.status === 'market' ? 'marketplace' : s.status}
                </span>
              </td>
              <td>
                <div className="mcp-actions-cell">
                  <span
                    className={cn('mcp-switch', s.enabled && 'on')}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggle(s)
                    }}
                  />
                  <button
                    type="button"
                    className="mcp-ico-btn"
                    title="Inspect"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(s)
                    }}
                  >
                    {Ico.tool}
                  </button>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
