/**
 * section-hermes-plugin.tsx — Hermes Plugin status and connection section.
 *
 * Renders: status pill (Active/Stale/Inactive), compat banner, connection card,
 * reported-settings list, and degraded / unreachable states.
 *
 * Poll cadences (per plan P3 / Codex finding 10):
 *   - 30 s  when pluginAvailable && backendReachable  (healthy)
 *   - 60 s  when !backendReachable                    (transient unreachable)
 *   - false when backendReachable && !pluginAvailable  (confirmed absent)
 * refetchOnWindowFocus: true covers focus-triggered recovery in the absent case.
 */

import { useQuery } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'

// ── API contract ─────────────────────────────────────────────────────────────

type HermesPluginSnapshot = {
  pluginAvailable: boolean
  backendReachable: boolean
  status: {
    running: boolean
    last_heartbeat: string | null
    ttl_seconds: number
    manifest: Record<string, unknown> | null
    reported_settings: Record<string, unknown> | null
  } | null
  connection: {
    gateway_port: number | null
    dashboard_port: number | null
    frontend_port: number | null
    active_profile: string | null
    enabled_plugins: Array<string>
    auth_mode: string | null
  } | null
  compat: {
    compatible: boolean
    warn: string | null
    plugin_range: string | null
    frontend_version: string | null
  } | null
  registeredAt: string | null
}

async function fetchHermesPlugin(): Promise<HermesPluginSnapshot> {
  const resp = await fetch('/api/hermes-plugin')
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json() as Promise<HermesPluginSnapshot>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format seconds into a human-readable "Xs ago" / "Xm Xs ago" string. */
function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s > 0 ? `${m}m ${s}s ago` : `${m}m ago`
}

/**
 * Derive heartbeat age in seconds from an ISO timestamp string.
 * Returns null when last_heartbeat is null / unparseable.
 */
function heartbeatAge(last_heartbeat: string | null): number | null {
  if (!last_heartbeat) return null
  const ts = Date.parse(last_heartbeat)
  if (isNaN(ts)) return null
  return Math.max(0, (Date.now() - ts) / 1000)
}

/** Determine status pill variant from snapshot. */
function pillar(snap: HermesPluginSnapshot): 'active' | 'stale' | 'inactive' {
  const st = snap.status
  if (!st || !st.running) return 'inactive'
  const age = heartbeatAge(st.last_heartbeat)
  if (age === null) return 'inactive'
  if (age > st.ttl_seconds) return 'stale'
  return 'active'
}

const PILL_STYLES: Record<string, React.CSSProperties> = {
  active: {
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
    fontWeight: 600,
    background: 'var(--m-fill-subtle, var(--theme-accent-subtle))',
    color: 'var(--m-green-500, var(--theme-accent))',
    border: '1px solid var(--m-green-500, var(--theme-accent))',
  },
  stale: {
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
    fontWeight: 600,
    background: 'var(--m-fill-subtle, var(--theme-warning))',
    color: 'var(--m-warning, var(--theme-warning))',
    border: '1px solid var(--m-warning, var(--theme-warning))',
  },
  inactive: {
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
    fontWeight: 600,
    background: 'var(--m-fill-subtle, var(--theme-accent-subtle))',
    color: 'var(--m-text-faint, var(--theme-muted))',
    border: '1px solid var(--m-text-faint, var(--theme-muted))',
  },
}

const BANNER_STYLES = {
  neutral: {
    padding: '8px 12px',
    borderRadius: '6px',
    background: 'var(--m-fill-subtle, var(--theme-accent-subtle))',
    border: '1px solid var(--m-fill-subtle, var(--theme-accent-subtle))',
    fontSize: '12px',
    color: 'var(--m-text-faint, var(--theme-muted))',
    fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
  } as React.CSSProperties,
  amber: {
    padding: '8px 12px',
    borderRadius: '6px',
    background: 'var(--m-fill-subtle, var(--theme-warning))',
    border: '1px solid var(--m-fill-subtle, var(--theme-warning))',
    fontSize: '12px',
    color: 'var(--m-warning, var(--theme-warning))',
    fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
  } as React.CSSProperties,
  red: {
    padding: '8px 12px',
    borderRadius: '6px',
    background: 'var(--m-fill-subtle, var(--theme-danger))',
    border: '1px solid var(--m-fill-subtle, var(--theme-danger))',
    fontSize: '12px',
    color: 'var(--m-danger, var(--theme-danger))',
    fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
  } as React.CSSProperties,
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CompatBanner({ compat }: { compat: HermesPluginSnapshot['compat'] }) {
  if (compat === null) {
    return (
      <div style={BANNER_STYLES.neutral}>
        Compatibility unknown — registration with the backend has not completed yet.
      </div>
    )
  }
  if (!compat.compatible) {
    return (
      <div style={BANNER_STYLES.red}>
        {compat.warn ?? 'Plugin version incompatible.'}
        {compat.plugin_range && (
          <span style={{ marginLeft: 8, opacity: 0.75 }}>
            (plugin range: {compat.plugin_range}
            {compat.frontend_version ? `, frontend: ${compat.frontend_version}` : ''})
          </span>
        )}
      </div>
    )
  }
  if (compat.warn) {
    return (
      <div style={BANNER_STYLES.amber}>
        {compat.warn}
        {compat.plugin_range && (
          <span style={{ marginLeft: 8, opacity: 0.75 }}>
            (plugin range: {compat.plugin_range}
            {compat.frontend_version ? `, frontend: ${compat.frontend_version}` : ''})
          </span>
        )}
      </div>
    )
  }
  return null
}

function ConnectionCard({ connection }: { connection: HermesPluginSnapshot['connection'] }) {
  if (!connection) return null
  const { gateway_port, dashboard_port, frontend_port, active_profile, auth_mode, enabled_plugins } = connection
  return (
    <SettingCard title="Connection">
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '6px 16px',
            fontSize: '12px',
            fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
          }}
        >
          {[
            ['Gateway port', gateway_port ?? '—'],
            ['Dashboard port', dashboard_port ?? '—'],
            ['Frontend port', frontend_port ?? '—'],
            ['Active profile', active_profile ?? '—'],
            ['Auth mode', auth_mode ?? '—'],
          ].map(([label, value]) => (
            <div key={label as string} style={{ display: 'contents' }}>
              <span style={{ color: 'var(--m-text-faint, var(--theme-muted))' }}>{label}</span>
              <span style={{ color: 'var(--m-text, var(--theme-text))' }}>{String(value)}</span>
            </div>
          ))}
        </div>
        {enabled_plugins.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
            {enabled_plugins.map((p) => (
              <span
                key={p}
                style={{
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
                  background: 'var(--m-fill-subtle, var(--theme-accent-subtle))',
                  color: 'var(--m-green-500, var(--theme-accent))',
                  border: '1px solid var(--m-green-500, var(--theme-accent))',
                }}
              >
                {p}
              </span>
            ))}
          </div>
        )}
      </div>
    </SettingCard>
  )
}

function ReportedSettings({ reported }: { reported: Record<string, unknown> | null }) {
  const entries = reported ? Object.entries(reported) : []
  return (
    <SettingCard title="Reported settings">
      <div style={{ padding: '12px 16px', fontFamily: 'var(--m-font-mono, ui-monospace, monospace)', fontSize: '12px' }}>
        {entries.length === 0 ? (
          <span style={{ color: 'var(--m-text-faint, var(--theme-muted))' }}>Nothing reported yet.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {entries.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: '12px' }}>
                <span style={{ color: 'var(--m-text-faint, var(--theme-muted))', minWidth: '160px' }}>{k}</span>
                <span style={{ color: 'var(--m-text, var(--theme-text))' }}>
                  {typeof v === 'string' ? v : JSON.stringify(v)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingCard>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SectionHermesPlugin() {
  const query = useQuery<HermesPluginSnapshot>({
    queryKey: ['hermes-plugin'],
    queryFn: fetchHermesPlugin,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchInterval: (q) => {
      const data = q.state.data
      if (!data) return 30_000
      if (data.backendReachable && data.pluginAvailable) return 30_000
      if (!data.backendReachable) return 60_000
      // confirmed absent (backendReachable && !pluginAvailable)
      return false
    },
    retry: 1,
  })

  const data = query.data

  // ── Loading state ──────────────────────────────────────────────────────────
  if (query.isLoading && !data) {
    return (
      <div>
        <div className="section-head">
          <div>
            <h2>Hermes Plugin</h2>
            <div className="desc">Plugin integration status and backend connection.</div>
          </div>
          <div className="meta">Section · <b>hermes-plugin</b></div>
        </div>
        <div className="card">
          <h3>Status</h3>
          <div
            style={{
              padding: '18px 16px',
              fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
              fontSize: '12px',
              color: 'var(--m-text-faint, var(--theme-muted))',
            }}
          >
            loading…
          </div>
        </div>
      </div>
    )
  }

  // ── Workspace route error (query.isError, distinct from degraded states) ──
  if (query.isError && !data) {
    return (
      <div>
        <div className="section-head">
          <div>
            <h2>Hermes Plugin</h2>
            <div className="desc">Plugin integration status and backend connection.</div>
          </div>
          <div className="meta">Section · <b>hermes-plugin</b></div>
        </div>
        <div className="card">
          <h3>Status</h3>
          <div
            style={{
              padding: '18px 16px',
              fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
              fontSize: '12px',
              color: 'var(--m-danger, var(--theme-danger))',
            }}
          >
            Unable to reach /api/hermes-plugin — workspace route error. Check dashboard auth/session state first, then refresh. If the dashboard was just upgraded, restart it so protected routes remount.
          </div>
        </div>
      </div>
    )
  }

  // From this point data is available (may be stale during background refetch).
  // Use data! (guaranteed non-null after loading+error guards above).
  const snap = data!

  const statusVariant = pillar(snap)
  const age = snap.status ? heartbeatAge(snap.status.last_heartbeat) : null

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Hermes Plugin</h2>
          <div className="desc">Plugin integration status and backend connection.</div>
        </div>
        <div className="meta">Section · <b>hermes-plugin</b></div>
      </div>

      {/* ── Status card ─────────────────────────────────────────────────── */}
      <SettingCard title="Status">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

          {/* Backend unreachable banner */}
          {!snap.backendReachable && (
            <div style={BANNER_STYLES.amber}>
              Backend temporarily unreachable — retrying. If this persists, re-authenticate to the dashboard proxy or restart the Hermes dashboard/plugin pair.
              {snap.status && (
                <span style={{ marginLeft: 8, opacity: 0.75 }}>(Showing last-known data)</span>
              )}
            </div>
          )}

          {/* Confirmed-absent card */}
          {snap.backendReachable && !snap.pluginAvailable ? (
            <div style={{ fontSize: '13px', color: 'var(--m-text-faint, var(--theme-muted))', fontFamily: 'var(--m-font-mono, ui-monospace, monospace)' }}>
              Hermes plugin not detected — enable{' '}
              <code
                style={{
                  background: 'var(--m-fill-subtle, var(--theme-accent-subtle))',
                  borderRadius: '3px',
                  padding: '1px 4px',
                }}
              >
                hermes-switch-ui
              </code>{' '}
              in your active backend profile. If it is already enabled, this session may still be missing dashboard auth for protected plugin routes.
            </div>
          ) : (
            /* Healthy / degraded reachable states */
            <SettingRow label="Plugin" desc="hermes-switch-ui integration">
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={PILL_STYLES[statusVariant]}>
                  {statusVariant === 'active' ? 'Active' : statusVariant === 'stale' ? 'Stale' : 'Inactive'}
                </span>
                {age !== null && (
                  <span
                    style={{
                      fontSize: '11px',
                      fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
                      color: 'var(--m-text-faint, var(--theme-muted))',
                    }}
                  >
                    {formatAge(age)}
                  </span>
                )}
              </span>
            </SettingRow>
          )}

          {/* Compat banner */}
          <CompatBanner compat={snap.compat} />

          {/* Registration timestamp */}
          {snap.registeredAt && (
            <div
              style={{
                fontSize: '11px',
                fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
                color: 'var(--m-text-faint, var(--theme-muted))',
              }}
            >
              Registered {snap.registeredAt}
            </div>
          )}
        </div>
      </SettingCard>

      {/* Connection card — only when data exists */}
      {snap.connection && <ConnectionCard connection={snap.connection} />}

      {/* Reported settings — only when status.reported_settings available */}
      {snap.status && <ReportedSettings reported={snap.status.reported_settings} />}
    </div>
  )
}
