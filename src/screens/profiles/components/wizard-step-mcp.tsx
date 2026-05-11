import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { NewAgentDraft } from '../types'
import type { McpServerConfig } from '@/server/profiles-browser'
import { McpServerList, fetchMcpServers, serverToConfig, HARDCODED_CATALOG } from './mcp-server-list'
import type { McpServer } from './mcp-server-list'

type Props = {
  draft: NewAgentDraft
  errors: string[]
  onChange: (patch: Partial<NewAgentDraft>) => void
}

export function WizardStepMcp({ draft, errors, onChange }: Props) {
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

      <McpServerList
        servers={servers}
        selected={draft.mcp_servers}
        onToggle={toggle}
        onEnvChange={setEnv}
      />

      {Object.keys(draft.mcp_servers).length > 0 && (
        <div className="wiz-hint" style={{ marginTop: 12 }}>
          {Object.keys(draft.mcp_servers).length} server{Object.keys(draft.mcp_servers).length === 1 ? '' : 's'} selected
        </div>
      )}
    </div>
  )
}
