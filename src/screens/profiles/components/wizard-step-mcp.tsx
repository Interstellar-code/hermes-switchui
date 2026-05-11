import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { NewAgentDraft } from '../types'
import type { McpServerConfig } from '@/server/profiles-browser'

type McpServer = {
  name: string
  url?: string
  command?: string
  args?: string[]
  status?: string
  enabled?: boolean
  transportType?: string
}

type Props = {
  draft: NewAgentDraft
  errors: string[]
  onChange: (patch: Partial<NewAgentDraft>) => void
}

// Hardcoded catalog fallback — common MCP servers
// TODO: replace with /api/mcp/catalog when endpoint is available
const HARDCODED_CATALOG: McpServer[] = [
  { name: 'context-mode', url: 'https://mcp.context7.com/mcp' },
  { name: 'filesystem', command: 'npx', args: ['@modelcontextprotocol/server-filesystem', '.'] },
  { name: 'claude-mem', command: 'npx', args: ['@anthropic-ai/claude-mem-mcp'] },
]

async function fetchMcpServers(): Promise<McpServer[]> {
  try {
    const r = await fetch('/api/mcp')
    if (!r.ok) return HARDCODED_CATALOG
    const data = (await r.json()) as { servers?: McpServer[] }
    const servers = data.servers ?? []
    // Merge with hardcoded catalog — add catalog entries not already in runtime list
    const names = new Set(servers.map((s) => s.name))
    const extras = HARDCODED_CATALOG.filter((c) => !names.has(c.name))
    return [...servers, ...extras]
  } catch {
    return HARDCODED_CATALOG
  }
}

function serverToConfig(s: McpServer): McpServerConfig {
  const cfg: McpServerConfig = {}
  if (s.url) cfg.url = s.url
  if (s.command) cfg.command = s.command
  if (s.args && s.args.length > 0) cfg.args = s.args
  return cfg
}

export function WizardStepMcp({ draft, errors, onChange }: Props) {
  const [envInputs, setEnvInputs] = useState<Record<string, string>>({})

  const mcpQuery = useQuery({
    queryKey: ['mcp', 'catalog'],
    queryFn: fetchMcpServers,
    staleTime: 60_000,
  })

  const servers = mcpQuery.data ?? HARDCODED_CATALOG

  function toggle(s: McpServer) {
    const next = { ...draft.mcp_servers }
    if (next[s.name]) {
      delete next[s.name]
    } else {
      next[s.name] = serverToConfig(s)
    }
    onChange({ mcp_servers: next })
  }

  function setEnv(serverName: string, key: string, value: string) {
    const next = { ...draft.mcp_servers }
    if (!next[serverName]) return
    next[serverName] = {
      ...next[serverName],
      env: { ...(next[serverName].env ?? {}), [key]: value },
    }
    onChange({ mcp_servers: next })
    setEnvInputs((prev) => ({ ...prev, [`${serverName}:${key}`]: value }))
  }

  // Detect env vars needed: servers with no url and no command usually need config
  const ENV_REQUIREMENTS: Record<string, Array<{ key: string; label: string }>> = {
    'github': [{ key: 'GITHUB_TOKEN', label: 'GitHub Token' }],
    'brave-search': [{ key: 'BRAVE_API_KEY', label: 'Brave API Key' }],
  }

  return (
    <div>
      <h3>MCP Servers</h3>
      <p className="lead">
        Select MCP servers to make available in this agent. Selected servers are
        added to the agent's config — they can be changed later via the edit drawer.
      </p>

      {errors.length > 0 && (
        <div className="wiz-errors">
          {errors.map((e) => (
            <div key={e} className="wiz-error">{e}</div>
          ))}
        </div>
      )}

      {mcpQuery.isLoading && <div className="wiz-loading">Loading MCP servers…</div>}

      <div className="skill-grid">
        {servers.map((s) => {
          const on = Boolean(draft.mcp_servers[s.name])
          const envReqs = ENV_REQUIREMENTS[s.name] ?? []
          return (
            <div key={s.name}>
              <div
                className={`skill${on ? ' on' : ''}`}
                onClick={() => toggle(s)}
              >
                <div className="chk" />
                <div>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  {s.url && (
                    <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>
                      {s.url.replace(/^https?:\/\//, '').slice(0, 40)}
                    </div>
                  )}
                  {s.command && (
                    <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>
                      {s.command} {(s.args ?? []).join(' ').slice(0, 30)}
                    </div>
                  )}
                  {s.status && s.status !== 'connected' && (
                    <div style={{ fontSize: 9, opacity: 0.5, marginTop: 2, textTransform: 'uppercase' }}>
                      {s.status}
                    </div>
                  )}
                </div>
              </div>
              {on && envReqs.length > 0 && (
                <div className="wiz-mcp-env">
                  {envReqs.map(({ key, label }) => (
                    <div key={key} style={{ marginTop: 6 }}>
                      <label className="wiz-hint" style={{ display: 'block', marginBottom: 3 }}>{label}</label>
                      <input
                        className="wiz-input"
                        style={{ fontSize: 11 }}
                        type="password"
                        placeholder={key}
                        value={envInputs[`${s.name}:${key}`] ?? draft.mcp_servers[s.name]?.env?.[key] ?? ''}
                        onChange={(e) => setEnv(s.name, key, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {Object.keys(draft.mcp_servers).length > 0 && (
        <div className="wiz-hint" style={{ marginTop: 12 }}>
          {Object.keys(draft.mcp_servers).length} server{Object.keys(draft.mcp_servers).length === 1 ? '' : 's'} selected
        </div>
      )}
    </div>
  )
}
