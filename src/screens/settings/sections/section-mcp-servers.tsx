/**
 * section-mcp-servers.tsx — MCP servers config + toolsets table (P4).
 *
 * Config rows go through the settings store / saver.
 * Toolsets table is read-only, fetched via react-query.
 */

import { useQuery } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { useSettingsStore } from '@/stores/settings-store'
import { listToolsets } from '@/server/hermes-api'

type ToolsetEntry = {
  name: string
  label?: string
  enabled?: boolean
  [key: string]: unknown
}

export default function SectionMcpServers() {
  const { draft, set } = useSettingsStore()

  const mcpEnabled = (draft['config.mcp.enabled'] as boolean | undefined) ?? true
  const autostart = (draft['config.mcp.autostart'] as boolean | undefined) ?? true
  const connectTimeout = (draft['config.mcp.connect_timeout_s'] as number | undefined) ?? 15
  const verboseLogging = (draft['config.mcp.verbose'] as boolean | undefined) ?? false

  const { data: toolsetsRaw, isLoading } = useQuery({
    queryKey: ['toolsets-list'],
    queryFn: listToolsets,
    staleTime: 30_000,
  })

  const toolsets = (Array.isArray(toolsetsRaw) ? toolsetsRaw : []) as Array<ToolsetEntry>

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>MCP Servers</h2>
          <div className="desc">MCP server connection settings and mounted toolsets.</div>
        </div>
        <div className="meta">Section · <b>mcp-servers</b></div>
      </div>

      <SettingCard title="Connection">
        <SettingRow label="MCP enabled" desc="Enable the Model Context Protocol subsystem">
          <label className="toggle">
            <input
              type="checkbox"
              checked={mcpEnabled}
              onChange={(e) => set('config.mcp.enabled', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
        <SettingRow label="Auto-start on launch" desc="Start MCP servers automatically when the agent launches">
          <label className="toggle">
            <input
              type="checkbox"
              checked={autostart}
              onChange={(e) => set('config.mcp.autostart', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
        <SettingRow label="Connect timeout" desc={`${connectTimeout}s — seconds to wait for MCP server connection`}>
          <input
            type="range"
            min={5}
            max={60}
            step={5}
            value={connectTimeout}
            onChange={(e) => set('config.mcp.connect_timeout_s', parseInt(e.target.value, 10))}
          />
        </SettingRow>
        <SettingRow label="Verbose logging" desc="Log all MCP protocol messages to the agent log">
          <label className="toggle">
            <input
              type="checkbox"
              checked={verboseLogging}
              onChange={(e) => set('config.mcp.verbose', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
      </SettingCard>

      <SettingCard
        title="Mounted toolsets"
        sub="Mounted toolsets — config above controls runtime behavior"
      >
        {isLoading ? (
          <div style={{ padding: '16px', color: 'var(--m-text-faint)', font: '12px var(--m-font-mono)' }}>
            Loading…
          </div>
        ) : toolsets.length === 0 ? (
          <div style={{ padding: '16px', color: 'var(--m-text-faint)', font: '12px var(--m-font-mono)' }}>
            No toolsets mounted.
          </div>
        ) : (
          <div className="mini-table-wrap">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Label</th>
                  <th>Enabled</th>
                </tr>
              </thead>
              <tbody>
                {toolsets.map((ts) => (
                  <tr key={ts.name}>
                    <td style={{ font: '12px var(--m-font-mono)' }}>{ts.name}</td>
                    <td style={{ color: 'var(--m-text-faint)' }}>{ts.label ?? ts.name}</td>
                    <td style={{ color: ts.enabled ? 'var(--m-accent)' : 'var(--m-text-faint)' }}>
                      {ts.enabled ? 'Yes' : 'No'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingCard>
    </div>
  )
}
