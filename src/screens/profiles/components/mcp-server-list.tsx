import { useState } from 'react'
import type { McpServerConfig } from '@/server/profiles-browser'

export type McpServer = {
  name: string
  url?: string
  command?: string
  args?: string[]
  status?: string
  enabled?: boolean
  transportType?: string
}

export const ENV_REQUIREMENTS: Record<string, Array<{ key: string; label: string }>> = {
  'github': [{ key: 'GITHUB_TOKEN', label: 'GitHub Token' }],
  'brave-search': [{ key: 'BRAVE_API_KEY', label: 'Brave API Key' }],
}

export const HARDCODED_CATALOG: McpServer[] = [
  { name: 'context-mode', url: 'https://mcp.context7.com/mcp' },
  { name: 'filesystem', command: 'npx', args: ['@modelcontextprotocol/server-filesystem', '.'] },
  { name: 'claude-mem', command: 'npx', args: ['@anthropic-ai/claude-mem-mcp'] },
]

export async function fetchMcpServers(): Promise<McpServer[]> {
  try {
    const r = await fetch('/api/mcp')
    if (!r.ok) return HARDCODED_CATALOG
    const data = (await r.json()) as { servers?: McpServer[] }
    const servers = data.servers ?? []
    const names = new Set(servers.map((s) => s.name))
    const extras = HARDCODED_CATALOG.filter((c) => !names.has(c.name))
    return [...servers, ...extras]
  } catch {
    return HARDCODED_CATALOG
  }
}

export function serverToConfig(s: McpServer): McpServerConfig {
  const cfg: McpServerConfig = {}
  if (s.url) cfg.url = s.url
  if (s.command) cfg.command = s.command
  if (s.args && s.args.length > 0) cfg.args = s.args
  return cfg
}

type McpServerListProps = {
  servers: McpServer[]
  selected: Record<string, McpServerConfig>
  readonly?: boolean
  onToggle: (s: McpServer) => void
  onEnvChange: (serverName: string, key: string, value: string) => void
}

export function McpServerList({ servers, selected, readonly = false, onToggle, onEnvChange }: McpServerListProps) {
  const [expandedServer, setExpandedServer] = useState<string | null>(null)

  return (
    <div className="mcp-list">
      {servers.map((s) => {
        const on = Boolean(selected[s.name])
        const envReqs = ENV_REQUIREMENTS[s.name] ?? []
        const isExpanded = expandedServer === s.name
        const cmdDisplay = s.command
          ? `${s.command} ${(s.args ?? []).join(' ')}`
          : s.url ?? ''
        const type = s.command ? 'stdio' : 'http'

        return (
          <div key={s.name} className={`mcp-row${on ? ' is-selected' : ''}`}>
            {/* checkbox col */}
            <button
              type="button"
              className="mcp-row-chk"
              onClick={() => { if (!readonly) onToggle(s) }}
              aria-pressed={on}
              aria-label={`${on ? 'Deselect' : 'Select'} ${s.name}`}
              disabled={readonly}
            >
              {on ? '▪' : '▫'}
            </button>

            {/* name + type chip */}
            <div className="mcp-row-meta">
              <span className="mcp-row-name">{s.name}</span>
              <span className={`mcp-row-type ${type}`}>{type}</span>
              {s.status && s.status !== 'connected' && (
                <span className="mcp-row-status">{s.status}</span>
              )}
              {!isExpanded && envReqs.length > 0 && on && (
                <span className="mcp-row-env-badge">🔒 {envReqs.length} env key{envReqs.length > 1 ? 's' : ''}</span>
              )}
              {!isExpanded && envReqs.length > 0 && !on && (
                <span className="mcp-row-env-badge muted">🔒 env needed</span>
              )}
            </div>

            {/* truncated command/url */}
            <div
              className="mcp-row-cmd"
              title={cmdDisplay}
            >
              {cmdDisplay}
            </div>

            {/* expand toggle */}
            <button
              type="button"
              className="mcp-row-expand-btn"
              onClick={() => setExpandedServer(isExpanded ? null : s.name)}
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${s.name}`}
            >
              {isExpanded ? '▲' : '▼'}
            </button>

            {/* expanded details row */}
            {isExpanded && (
              <div className="mcp-row-details">
                {s.command && (
                  <div className="mcp-row-details-section">
                    <span className="mcp-row-details-label">command</span>
                    <code className="mcp-row-details-value">{s.command}{s.args && s.args.length > 0 ? ' ' + s.args.join(' ') : ''}</code>
                  </div>
                )}
                {s.url && (
                  <div className="mcp-row-details-section">
                    <span className="mcp-row-details-label">url</span>
                    <code className="mcp-row-details-value">{s.url}</code>
                  </div>
                )}
                {on && envReqs.length > 0 && !readonly && (
                  <div className="mcp-row-details-env">
                    {envReqs.map(({ key, label }) => (
                      <div key={key} className="mcp-row-details-env-row">
                        <label className="mcp-row-details-env-label">{label}</label>
                        <input
                          className="mcp-row-details-env-input"
                          type="password"
                          placeholder={key}
                          value={selected[s.name]?.env?.[key] ?? ''}
                          onChange={(e) => onEnvChange(s.name, key, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
