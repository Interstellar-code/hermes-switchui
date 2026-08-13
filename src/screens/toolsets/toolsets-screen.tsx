'use client'

import '@/styles/matrix-skills.css'
import { useMemo, useState } from 'react'
import type { NormalizedToolset } from '@/lib/toolsets'
import {
  PLUGINS_GROUP,
  TOOLSET_GROUPS,
  buildStaticToolsetCatalog,
  getToolsetSecurityHint,
  isToolsetSuppressed,
} from '@/lib/toolsets'
import { useToolsetCatalog } from '@/lib/toolsets-api'
import { cn } from '@/lib/utils'

/**
 * The Toolsets screen — the surface behind `/toolsets` and `/tools`.
 *
 * **Read-only, deliberately.** The agent's own `/toolsets` is "List available
 * toolsets", and its `/tools enable|disable` writes `~/.hermes/config.yaml` and
 * then calls `new_session()`, discarding the conversation. Shipping that behind
 * a checkbox would be a data-loss toggle, so this screen lists and explains
 * rather than mutates. See `docs/plans/hermes-slash-commands-in-switchui.md`
 * §4.2 and the notes in `use-slash-commands.ts`.
 */

export type ToolsetRowState = 'enabled' | 'suppressed' | 'unknown'

/**
 * What the catalog actually lets us say about one row.
 *
 * `gatewayEnabled` only exists on a live payload, so `'unknown'` is the only
 * honest answer for the static fallback — `isToolsetSuppressed()` is given the
 * real `source` rather than an assumed one, which is what stops the fallback
 * from inventing a suppression it has no way to observe. `locallyEnabled` is
 * `true` here because this screen has no draft to compare against: every
 * toolset is "selected" from its point of view, so the only question left is
 * whether the gateway is suppressing it right now.
 */
export function toolsetRowState(
  toolset: NormalizedToolset,
  source: 'gateway' | 'static',
): ToolsetRowState {
  if (source !== 'gateway') return 'unknown'
  if (isToolsetSuppressed(toolset, source, true)) return 'suppressed'
  return toolset.gatewayEnabled === true ? 'enabled' : 'unknown'
}

const STATE_LABEL: Record<ToolsetRowState, string> = {
  enabled: 'Enabled',
  suppressed: 'Suppressed',
  unknown: 'Unknown',
}

const STATE_CLASS: Record<ToolsetRowState, string> = {
  enabled: 'active',
  suppressed: 'disabled',
  unknown: 'unknown',
}

const SUPPRESSED_HINT =
  "Suppressed by the gateway's current configuration — the toolset exists, " +
  'but the agent will not be given its tools right now.'

/** Static groups first, plugin-registered toolsets last. */
export function orderToolsetGroups(
  toolsets: Array<NormalizedToolset>,
): Array<string> {
  const present = new Set(toolsets.map((t) => t.group))
  const known = TOOLSET_GROUPS.filter((group) => present.has(group))
  const extras = [...present]
    .filter((group) => group !== PLUGINS_GROUP && !TOOLSET_GROUPS.includes(group))
    .sort((a, b) => a.localeCompare(b))
  return [
    ...known,
    ...extras,
    ...(present.has(PLUGINS_GROUP) ? [PLUGINS_GROUP] : []),
  ]
}

type StateFilter = 'all' | ToolsetRowState

function ToolsetRow({
  toolset,
  state,
}: {
  toolset: NormalizedToolset
  state: ToolsetRowState
}) {
  const hint = getToolsetSecurityHint(toolset.key)
  // Both can apply at once — `browser` is destructive *and* frequently off —
  // and dropping either one loses information the row exists to carry.
  const notes = [state === 'suppressed' ? SUPPRESSED_HINT : null, hint].filter(
    (value): value is string => Boolean(value),
  )
  return (
    <tr>
      <td>
        <strong>{toolset.label}</strong>
        <span className="sk-card-tags" style={{ padding: 0, marginTop: 4 }}>
          {toolset.plugin && (
            <span
              className="sk-tag origin"
              title="Registered by a Hermes plugin"
            >
              🔌 Plugin
            </span>
          )}
          {toolset.destructive && (
            <span
              className="sk-tag scan-med"
              title={
                hint ??
                'Grants powerful system access — disable for read-only or review agents'
              }
            >
              ⚠ Destructive
            </span>
          )}
        </span>
      </td>
      <td>
        <code>{toolset.key}</code>
      </td>
      <td>
        <span className={`sk-status-pill ${STATE_CLASS[state]}`}>
          <span className="dot" />
          {STATE_LABEL[state]}
        </span>
      </td>
      <td>
        {notes.length === 0
          ? '—'
          : notes.map((value) => (
              <p key={value} style={{ margin: '0 0 4px' }}>
                {value}
              </p>
            ))}
      </td>
    </tr>
  )
}

export function ToolsetsScreen() {
  const catalogQuery = useToolsetCatalog()
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)

  const data = catalogQuery.data
  // While loading or on error the static catalog keeps the screen rendering,
  // and `source` stays 'static' — which is exactly the state banner below
  // reports. Nothing here ever claims live data it does not have.
  const toolsets = data?.toolsets ?? buildStaticToolsetCatalog()
  const source: 'gateway' | 'static' = data?.source ?? 'static'

  const rows = useMemo(
    () =>
      toolsets.map((toolset) => ({
        toolset,
        state: toolsetRowState(toolset, source),
      })),
    [source, toolsets],
  )

  const counts = useMemo(
    () => ({
      all: rows.length,
      enabled: rows.filter((row) => row.state === 'enabled').length,
      suppressed: rows.filter((row) => row.state === 'suppressed').length,
      unknown: rows.filter((row) => row.state === 'unknown').length,
      plugin: rows.filter((row) => row.toolset.plugin).length,
      destructive: rows.filter((row) => row.toolset.destructive).length,
    }),
    [rows],
  )

  const groups = useMemo(() => orderToolsetGroups(toolsets), [toolsets])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter(({ toolset, state }) => {
      if (stateFilter !== 'all' && state !== stateFilter) return false
      if (groupFilter !== 'all' && toolset.group !== groupFilter) return false
      if (!term) return true
      return [toolset.label, toolset.key, toolset.group].some((field) =>
        field.toLowerCase().includes(term),
      )
    })
  }, [groupFilter, rows, search, stateFilter])

  const visibleGroups = groups.filter((group) =>
    visible.some((row) => row.toolset.group === group),
  )

  return (
    <div
      className="h-screen bg-surface text-ink sk-shell"
      data-screen="toolsets"
    >
      <aside className={cn('sk-filter', filtersCollapsed && 'collapsed')}>
        <div className="sk-filter-hdr">
          <h2>Toolsets</h2>
          <span className="ct">{counts.all}</span>
          <button
            type="button"
            onClick={() => setFiltersCollapsed((value) => !value)}
            title={filtersCollapsed ? 'Expand filters' : 'Collapse filters'}
            aria-label={filtersCollapsed ? 'Expand filters' : 'Collapse filters'}
            className="collapse-btn"
          >
            {filtersCollapsed ? '›' : '‹'}
          </button>
        </div>
        <div className="sk-filter-search">
          <input
            aria-label="Search toolsets"
            value={search}
            placeholder="Search toolsets…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="sk-filter-body">
          <div className="sk-filter-section">
            <div className="sec-label">State</div>
            <div className="sk-segment">
              <button
                type="button"
                className={cn(stateFilter === 'all' && 'active')}
                onClick={() => setStateFilter('all')}
              >
                All <span>{counts.all}</span>
              </button>
              <button
                type="button"
                className={cn(stateFilter === 'enabled' && 'active')}
                onClick={() => setStateFilter('enabled')}
              >
                Enabled <span>{counts.enabled}</span>
              </button>
              <button
                type="button"
                className={cn(stateFilter === 'suppressed' && 'active')}
                onClick={() => setStateFilter('suppressed')}
              >
                Suppressed <span>{counts.suppressed}</span>
              </button>
              {counts.unknown > 0 && (
                <button
                  type="button"
                  className={cn(stateFilter === 'unknown' && 'active')}
                  onClick={() => setStateFilter('unknown')}
                >
                  Unknown <span>{counts.unknown}</span>
                </button>
              )}
            </div>
          </div>
          <div className="sk-filter-section">
            <div className="sec-label">Group</div>
            <div className="sk-filter-list">
              <button
                type="button"
                aria-label={`All groups ${counts.all}`}
                className={cn('sk-filter-item', groupFilter === 'all' && 'active')}
                onClick={() => setGroupFilter('all')}
              >
                <span>All groups</span>
                <span className="item-ct">{counts.all}</span>
              </button>
              {groups.map((group) => {
                const size = toolsets.filter((t) => t.group === group).length
                return (
                  <button
                    key={group}
                    type="button"
                    aria-label={`${group} ${size}`}
                    className={cn(
                      'sk-filter-item',
                      groupFilter === group && 'active',
                    )}
                    onClick={() => setGroupFilter(group)}
                  >
                    <span>{group}</span>
                    <span className="item-ct">{size}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        <div className="sk-rail">
          <span className="rail-label">Toolsets</span>
          <span className="rail-badge">{counts.all}</span>
        </div>
      </aside>

      <div className="sk-main">
        <div className="sk-top">
          <div className="crumbs">
            <div className="title-group">
              <h1>Toolsets</h1>
              <span className="sub">Workspace / Tools / Toolsets</span>
            </div>
          </div>
          <div className="meta">
            <div className="stat">
              <span className="v ok">{counts.enabled}</span>
              <span className="l">Enabled</span>
            </div>
            <div className="stat">
              <span className="v">{counts.all}</span>
              <span className="l">Toolsets</span>
            </div>
          </div>
        </div>

        <div className="sk-canvas">
          {/* Provenance first: everything below means something different
              depending on whether it came from the gateway or the fallback. */}
          <div className="sk-security" data-testid="toolset-source-notice">
            <p className="sec-title">
              {catalogQuery.isLoading
                ? 'Loading'
                : source === 'gateway'
                  ? 'Live gateway registry'
                  : 'Built-in fallback list — not live'}
            </p>
            <div
              className="sec-row"
              role="status"
              style={
                !catalogQuery.isLoading && source === 'static'
                  ? { color: 'var(--m-danger, var(--theme-danger, #ff6b6b))' }
                  : undefined
              }
            >
              {catalogQuery.isLoading
                ? 'Reading the live toolset registry from the Hermes gateway…'
                : source === 'gateway'
                  ? "Live from the Hermes gateway. Each row's state is the gateway's own resolution, so it reflects what the agent can actually call right now."
                  : "Showing SwitchUI's built-in toolset list because the gateway could not be reached. This is not live state — which toolsets are actually enabled is unknown until the gateway answers."}
            </div>
          </div>

          <div className="sk-stat-cards">
            <div className="sk-stat-card">
              <span className="val">{counts.all}</span>
              <span className="lbl">Total</span>
            </div>
            <div className="sk-stat-card">
              <span className="val ok">{counts.enabled}</span>
              <span className="lbl">Enabled</span>
            </div>
            <div className="sk-stat-card">
              <span className="val warn">{counts.destructive}</span>
              <span className="lbl">Destructive</span>
            </div>
            <div className="sk-stat-card">
              <span className="val">{counts.plugin}</span>
              <span className="lbl">From plugins</span>
            </div>
          </div>

          <div className="sk-security">
            <p className="sec-title">Read-only</p>
            {/* `.sec-row` is a flex row — fine for a bare string, wrong for
                prose with inline <code>, which it would break into separate
                flex items. Block paragraph, same type scale. */}
            <p
              style={{
                margin: 0,
                font: '400 11px var(--m-font-sans, system-ui, sans-serif)',
                color: 'var(--m-text, var(--theme-text))',
                lineHeight: 1.6,
              }}
            >
              Toolsets are listed here, not changed here. Enabling or disabling
              one rewrites <code>~/.hermes/config.yaml</code> and starts a fresh
              agent session, discarding the current conversation — so it stays
              in the Hermes CLI (<code>/tools enable|disable &lt;name&gt;</code>)
              until SwitchUI has a confirm flow for it.
            </p>
          </div>

          <div className="sk-toolbar">
            <span className="result-ct">
              {visible.length} of {counts.all} toolsets
            </span>
          </div>

          {visible.length === 0 ? (
            <div className="sk-empty">
              <div className="empty-icon">⌁</div>
              <h3>No matching toolsets</h3>
              <p>Try a different search, group or state filter.</p>
            </div>
          ) : (
            visibleGroups.map((group) => (
              <section key={group} style={{ marginBottom: 20 }}>
                <h2
                  className="m-mono"
                  data-testid="toolset-group-heading"
                  style={{
                    margin: '0 0 6px',
                    font: '600 10px var(--m-font-mono, ui-monospace, monospace)',
                    textTransform: 'uppercase',
                    letterSpacing: '.18em',
                    color: 'var(--m-text-faint, var(--theme-muted))',
                  }}
                >
                  {group}
                </h2>
                <table className="sk-table">
                  <thead>
                    <tr>
                      <th>Toolset</th>
                      <th>Key</th>
                      <th>State</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible
                      .filter((row) => row.toolset.group === group)
                      .map((row) => (
                        <ToolsetRow
                          key={row.toolset.key}
                          toolset={row.toolset}
                          state={row.state}
                        />
                      ))}
                  </tbody>
                </table>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
