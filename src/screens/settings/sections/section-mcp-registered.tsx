/**
 * section-mcp-registered.tsx — Registered MCP / dashboard plugins (P4).
 *
 * Fetches plugins via listDashboardPlugins(), renders an action table.
 * Enable/Disable/Update/Delete actions call API helpers directly with toast feedback.
 * Delete uses ConfirmDialog. Install modal uses local state + installAgentPlugin().
 * Rescan button calls GET /api/dashboard/plugins/rescan.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import {
  deleteAgentPlugin,
  disableAgentPlugin,
  enableAgentPlugin,
  installAgentPlugin,
  listDashboardPlugins,
  updateAgentPlugin,
} from '@/server/hermes-api'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import { toast } from '@/components/ui/toast'

type PluginEntry = {
  name: string
  version?: string
  description?: string
  enabled?: boolean
  [key: string]: unknown
}

export default function SectionMcpRegistered() {
  const queryClient = useQueryClient()

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [installIdentifier, setInstallIdentifier] = useState('')
  const [installBusy, setInstallBusy] = useState(false)

  const { data: pluginsRaw, isLoading } = useQuery({
    queryKey: ['dashboard-plugins'],
    queryFn: listDashboardPlugins,
    staleTime: 30_000,
  })

  const plugins = (Array.isArray(pluginsRaw) ? pluginsRaw : []) as Array<PluginEntry>

  async function refetch() {
    await queryClient.invalidateQueries({ queryKey: ['dashboard-plugins'] })
  }

  async function handleEnable(name: string) {
    try {
      await enableAgentPlugin(name)
      toast(`Plugin "${name}" enabled`, { type: 'success' })
      await refetch()
    } catch {
      toast(`Failed to enable "${name}"`, { type: 'error' })
    }
  }

  async function handleDisable(name: string) {
    try {
      await disableAgentPlugin(name)
      toast(`Plugin "${name}" disabled`, { type: 'success' })
      await refetch()
    } catch {
      toast(`Failed to disable "${name}"`, { type: 'error' })
    }
  }

  async function handleUpdate(name: string) {
    try {
      await updateAgentPlugin(name)
      toast(`Plugin "${name}" updated`, { type: 'success' })
      await refetch()
    } catch {
      toast(`Failed to update "${name}"`, { type: 'error' })
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    const name = deleteTarget
    setDeleteTarget(null)
    try {
      await deleteAgentPlugin(name)
      toast(`Plugin "${name}" deleted`, { type: 'success' })
      await refetch()
    } catch {
      toast(`Failed to delete "${name}"`, { type: 'error' })
    }
  }

  async function handleInstall() {
    const id = installIdentifier.trim()
    if (!id) return
    setInstallBusy(true)
    try {
      await installAgentPlugin({ identifier: id, enable: true })
      toast(`Plugin "${id}" installed`, { type: 'success' })
      setInstallOpen(false)
      setInstallIdentifier('')
      await refetch()
    } catch {
      toast(`Failed to install "${id}"`, { type: 'error' })
    } finally {
      setInstallBusy(false)
    }
  }

  async function handleRescan() {
    try {
      const resp = await fetch('/api/dashboard/plugins/rescan')
      if (!resp.ok) throw new Error(resp.statusText)
      toast('Plugin rescan complete', { type: 'success' })
      await refetch()
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

      <SettingCard title="Plugins">
        {isLoading ? (
          <div style={{ padding: '16px', color: 'var(--m-text-faint)', font: '12px var(--m-font-mono)' }}>
            Loading…
          </div>
        ) : plugins.length === 0 ? (
          <div style={{ padding: '16px', color: 'var(--m-text-faint)', font: '12px var(--m-font-mono)' }}>
            No plugins installed.
          </div>
        ) : (
          <div className="mini-table-wrap">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Version</th>
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {plugins.map((plugin) => (
                  <tr key={plugin.name}>
                    <td style={{ font: '12px var(--m-font-mono)' }}>{plugin.name}</td>
                    <td style={{ color: 'var(--m-text-faint)' }}>{plugin.version ?? '—'}</td>
                    <td style={{ color: 'var(--m-text-faint)' }}>{plugin.description ?? '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {plugin.enabled ? (
                          <button
                            className="btn"
                            style={{ fontSize: '11px', padding: '2px 8px' }}
                            onClick={() => void handleDisable(plugin.name)}
                          >
                            Disable
                          </button>
                        ) : (
                          <button
                            className="btn btn-primary"
                            style={{ fontSize: '11px', padding: '2px 8px' }}
                            onClick={() => void handleEnable(plugin.name)}
                          >
                            Enable
                          </button>
                        )}
                        <button
                          className="btn"
                          style={{ fontSize: '11px', padding: '2px 8px' }}
                          onClick={() => void handleUpdate(plugin.name)}
                        >
                          Update
                        </button>
                        <button
                          className="btn btn-danger"
                          style={{ fontSize: '11px', padding: '2px 8px' }}
                          onClick={() => setDeleteTarget(plugin.name)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--m-border)', display: 'flex', gap: '8px' }}>
          <button className="btn btn-primary" onClick={() => setInstallOpen(true)}>
            Install
          </button>
          <button className="btn" onClick={() => void handleRescan()}>
            Rescan
          </button>
        </div>
      </SettingCard>

      {/* Install modal */}
      {installOpen && (
        <div className="pf-confirm-backdrop" onClick={() => setInstallOpen(false)}>
          <div
            className="pf-confirm"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3>Install Plugin</h3>
            <p>Enter the plugin identifier (e.g. package name, git URL, or registry slug).</p>
            <input
              type="text"
              className="text-input"
              style={{ width: '100%', marginBottom: '12px' }}
              placeholder="e.g. hermes-mcp-filesystem"
              value={installIdentifier}
              onChange={(e) => setInstallIdentifier(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleInstall()
                if (e.key === 'Escape') setInstallOpen(false)
              }}
              autoFocus
            />
            <div className="pf-confirm-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setInstallOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={installBusy || !installIdentifier.trim()}
                onClick={() => void handleInstall()}
              >
                {installBusy ? 'Installing…' : 'Install'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete plugin"
        message={`Delete "${deleteTarget ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
