import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { McpServerConfig } from '@/server/profiles-browser'

type McpServer = {
  name: string
  url?: string
  command?: string
  args?: string[]
  status?: string
}

type Props = {
  mcpServers: Record<string, McpServerConfig>
  readonly: boolean
  onSave: (patch: { mcp_servers: Record<string, McpServerConfig> }) => Promise<void>
}

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

export function DrawerTabMcp({ mcpServers, readonly, onSave }: Props) {
  const [selected, setSelected] = useState<Record<string, McpServerConfig>>({ ...mcpServers })
  const [busy, setBusy] = useState(false)

  const dirty = JSON.stringify(Object.keys(selected).sort()) !== JSON.stringify(Object.keys(mcpServers).sort())

  const mcpQuery = useQuery({
    queryKey: ['mcp', 'catalog'],
    queryFn: fetchMcpServers,
    staleTime: 60_000,
  })
  const servers = mcpQuery.data ?? HARDCODED_CATALOG

  function toggle(s: McpServer) {
    if (readonly) return
    const next = { ...selected }
    if (next[s.name]) {
      delete next[s.name]
    } else {
      next[s.name] = serverToConfig(s)
    }
    setSelected(next)
  }

  async function handleSave() {
    setBusy(true)
    try {
      await onSave({ mcp_servers: selected })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="pf-drawer-section-title">MCP Servers</p>

      {mcpQuery.isLoading && (
        <div style={{ fontFamily: 'monospace', fontSize: 11, opacity: .5, marginBottom: 12 }}>Loading servers…</div>
      )}

      <div className="skill-grid" style={{ marginBottom: 16 }}>
        {servers.map((s) => {
          const on = Boolean(selected[s.name])
          return (
            <div
              key={s.name}
              className={`skill${on ? ' on' : ''}`}
              onClick={() => toggle(s)}
              style={{ cursor: readonly ? 'default' : 'pointer', opacity: readonly ? .7 : 1 }}
            >
              <div className="chk" />
              <div>
                <div style={{ fontWeight: 600, fontSize: 12 }}>{s.name}</div>
                {s.url && (
                  <div style={{ fontSize: 10, opacity: .6, marginTop: 2 }}>
                    {s.url.replace(/^https?:\/\//, '').slice(0, 40)}
                  </div>
                )}
                {s.command && (
                  <div style={{ fontSize: 10, opacity: .6, marginTop: 2 }}>
                    {s.command} {(s.args ?? []).join(' ').slice(0, 30)}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {Object.keys(selected).length > 0 && (
        <div style={{ fontFamily: 'monospace', fontSize: 10, opacity: .55, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.12em' }}>
          {Object.keys(selected).length} server{Object.keys(selected).length === 1 ? '' : 's'} selected
        </div>
      )}

      {!readonly && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="pf-drawer-btn-save" onClick={() => void handleSave()} disabled={!dirty || busy}>
            {busy ? 'Saving…' : 'Save Changes'}
          </button>
          {dirty && (
            <button type="button" className="pf-drawer-btn-cancel" onClick={() => setSelected({ ...mcpServers })}>
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  )
}
