/**
 * WorkflowBackendToggle — dropdown for the /workflows page header.
 *
 * Shows current backend ('native' | 'plugin') and plugin status.
 * Switching to 'plugin' triggers ensurePluginInstalled() automatically.
 */
import { useState, useCallback } from 'react'
import { useWorkflowBackendStore, type WorkflowBackend } from '@/stores/workflow-backend-store'
import { ensurePluginInstalled } from '@/server/workflow-engine/ensure-plugin-installed'

type PluginState = 'idle' | 'checking' | 'installed' | 'not_found' | 'disabled' | 'error'

export function WorkflowBackendToggle() {
  const { backend, setBackend } = useWorkflowBackendStore()
  const [pluginState, setPluginState] = useState<PluginState>('idle')
  const [pluginMsg, setPluginMsg] = useState<string>()

  const handleChange = useCallback(
    async (next: WorkflowBackend) => {
      if (next === backend) return

      if (next === 'plugin') {
        setPluginState('checking')
        try {
          const result = await ensurePluginInstalled()
          setPluginState(result.status === 'installed' ? 'installed' : result.status)
          setPluginMsg(result.message)
          if (result.status === 'installed') {
            setBackend('plugin')
          }
        } catch (e: unknown) {
          setPluginState('error')
          setPluginMsg(e instanceof Error ? e.message : String(e))
        }
      } else {
        setPluginState('idle')
        setPluginMsg(undefined)
        setBackend('native')
      }
    },
    [backend, setBackend],
  )

  const statusLabel: Record<PluginState, string> = {
    idle: '',
    checking: 'Checking…',
    installed: 'Installed',
    not_found: 'Not installed',
    disabled: 'Disabled',
    error: 'Error',
  }

  const statusColor: Record<PluginState, string> = {
    idle: 'transparent',
    checking: '#888',
    installed: '#4caf50',
    not_found: '#f44336',
    disabled: '#ff9800',
    error: '#f44336',
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '0.8rem',
      }}
    >
      <label htmlFor="wf-backend-select" style={{ color: 'var(--text-muted, #888)' }}>
        Backend:
      </label>
      <select
        id="wf-backend-select"
        value={backend}
        onChange={(e) => void handleChange(e.target.value as WorkflowBackend)}
        style={{
          background: 'var(--surface-2, #1e1e1e)',
          color: 'var(--text-1, #ccc)',
          border: '1px solid var(--border, #333)',
          borderRadius: '4px',
          padding: '2px 6px',
          cursor: 'pointer',
        }}
      >
        <option value="native">Native</option>
        <option value="plugin">Plugin</option>
      </select>

      {pluginState !== 'idle' && (
        <span
          style={{
            color: statusColor[pluginState],
            fontSize: '0.75rem',
          }}
          title={pluginMsg}
        >
          {statusLabel[pluginState]}
          {pluginMsg && pluginState === 'error' ? ` — ${pluginMsg.slice(0, 60)}` : ''}
        </span>
      )}
    </div>
  )
}
