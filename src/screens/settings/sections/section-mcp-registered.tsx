/**
 * section-mcp-registered.tsx — Registered dashboard plugins summary card.
 *
 * Summary card: total plugins, enabled count, "Open Plugins page →" button.
 * Preview list: top 3 plugins by name + Rescan button.
 * Full install/enable/disable/update/delete is handled on the plugins page.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { SettingCard } from '../components/setting-card'
import { listDashboardPlugins } from '@/server/hermes-api'
import { toast } from '@/components/ui/toast'

type PluginEntry = {
  name: string
  version?: string
  description?: string
  enabled?: boolean
  [key: string]: unknown
}

export default function SectionMcpRegistered() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: pluginsRaw, isLoading, isError } = useQuery({
    queryKey: ['dashboard-plugins'],
    queryFn: listDashboardPlugins,
    staleTime: 30_000,
    retry: 1,
  })

  const plugins = (Array.isArray(pluginsRaw) ? pluginsRaw : []) as Array<PluginEntry>
  const notDetected = isError || (!isLoading && plugins.length === 0)
  const enabledCount = plugins.filter(p => p.enabled).length
  const totalCount = plugins.length
  const preview = plugins.slice(0, 3)

  async function handleRescan() {
    try {
      const resp = await fetch('/api/dashboard/plugins/rescan')
      if (!resp.ok) throw new Error(resp.statusText)
      toast('Plugin rescan complete', { type: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-plugins'] })
    } catch {
      toast('Rescan failed', { type: 'error' })
    }
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Registered Servers</h2>
          <div className="desc">Installed dashboard plugins and agent extensions.</div>
        </div>
        <div className="meta">Section · <b>mcp-registered</b></div>
      </div>

      <SettingCard title="Status">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--m-text)' }}>
                Plugins
              </span>
              {isLoading ? (
                <span style={{ fontSize: '11px', color: 'var(--m-text-faint)', fontFamily: 'var(--m-font-mono)' }}>loading…</span>
              ) : notDetected ? (
                <span style={{ fontSize: '11px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-text-faint)' }}>None installed</span>
              ) : (
                <span style={{ fontSize: '11px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-accent)' }}>
                  ✓ {totalCount} {totalCount === 1 ? 'plugin' : 'plugins'} · {enabledCount} enabled
                </span>
              )}
            </div>
            <button
              className="btn"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() => void navigate({ to: '/mcp' })}
            >
              Open Plugins page →
            </button>
          </div>

          {!isLoading && preview.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-text-faint)' }}>
              {preview.map((p) => (
                <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: p.enabled ? 'var(--m-accent)' : 'var(--m-text-faint)',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: 'var(--m-text)' }}>{p.name}</span>
                  {p.version && <span>{p.version}</span>}
                  {p.description && (
                    <span style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '200px',
                    }}>
                      {p.description}
                    </span>
                  )}
                </div>
              ))}
              {totalCount > 3 && (
                <div style={{ color: 'var(--m-text-faint)', paddingLeft: '14px' }}>
                  +{totalCount - 3} more
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
            <button
              className="btn"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() => void handleRescan()}
            >
              Rescan
            </button>
          </div>
        </div>
      </SettingCard>
    </div>
  )
}
