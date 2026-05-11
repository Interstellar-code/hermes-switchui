import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { McpServerConfig } from '@/server/profiles-browser'
import { McpServerList, fetchMcpServers, serverToConfig, HARDCODED_CATALOG } from './mcp-server-list'
import type { McpServer } from './mcp-server-list'

type Props = {
  mcpServers: Record<string, McpServerConfig>
  readonly: boolean
  onSave: (patch: { mcp_servers: Record<string, McpServerConfig> }) => Promise<void>
}

export function DrawerTabMcp({ mcpServers, readonly, onSave }: Props) {
  const [selected, setSelected] = useState<Record<string, McpServerConfig>>(() => JSON.parse(JSON.stringify(mcpServers)) as Record<string, McpServerConfig>)
  const [busy, setBusy] = useState(false)

  const dirty = JSON.stringify(selected) !== JSON.stringify(mcpServers)

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

  function setEnv(serverName: string, key: string, value: string) {
    const next = { ...selected }
    if (!next[serverName]) return
    next[serverName] = {
      ...next[serverName],
      env: { ...(next[serverName].env ?? {}), [key]: value },
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

      <McpServerList
        servers={servers}
        selected={selected}
        readonly={readonly}
        onToggle={toggle}
        onEnvChange={setEnv}
      />

      {Object.keys(selected).length > 0 && (
        <div style={{ fontFamily: 'monospace', fontSize: 10, opacity: .55, marginTop: 12, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.12em' }}>
          {Object.keys(selected).length} server{Object.keys(selected).length === 1 ? '' : 's'} selected
        </div>
      )}

      {!readonly && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="pf-drawer-btn-save" onClick={() => void handleSave()} disabled={!dirty || busy}>
            {busy ? 'Saving…' : 'Save Changes'}
          </button>
          {dirty && (
            <button type="button" className="pf-drawer-btn-cancel" onClick={() => setSelected(JSON.parse(JSON.stringify(mcpServers)) as Record<string, McpServerConfig>)}>
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  )
}
