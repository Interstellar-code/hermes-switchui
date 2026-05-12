/**
 * section-mcp-servers.tsx — MCP runtime config summary card + toolsets count.
 *
 * Summary card: toolsets count from listToolsets(), "Open MCP page →" button.
 * No config rows — mcp.* keys do not exist in DEFAULT_CONFIG.
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { SettingCard } from '../components/setting-card'
import { listToolsets } from '@/lib/hermes-client'

type ToolsetEntry = {
  name: string
  label?: string
  enabled?: boolean
  [key: string]: unknown
}

export default function SectionMcpServers() {
  const navigate = useNavigate()

  const { data: toolsetsRaw, isLoading, isError } = useQuery({
    queryKey: ['toolsets-list'],
    queryFn: listToolsets,
    staleTime: 30_000,
    retry: 1,
  })

  const toolsets = (Array.isArray(toolsetsRaw) ? toolsetsRaw : []) as Array<ToolsetEntry>
  const notDetected = isError || (!isLoading && toolsets.length === 0)
  const enabledCount = toolsets.filter(ts => ts.enabled).length
  const totalCount = toolsets.length

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>MCP Servers</h2>
          <div className="desc">MCP server connection settings and mounted toolsets.</div>
        </div>
        <div className="meta">Section · <b>mcp-servers</b></div>
      </div>

      <SettingCard title="Status">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--m-text)' }}>
                MCP Toolsets
              </span>
              {isLoading ? (
                <span style={{ fontSize: '11px', color: 'var(--m-text-faint)', fontFamily: 'var(--m-font-mono)' }}>loading…</span>
              ) : notDetected ? (
                <span style={{ fontSize: '11px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-danger, #e05)' }}>⚠ Not detected</span>
              ) : (
                <span style={{ fontSize: '11px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-accent)' }}>
                  ✓ {totalCount} {totalCount === 1 ? 'toolset' : 'toolsets'} · {enabledCount} enabled
                </span>
              )}
            </div>
            <button
              className="btn"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() => void navigate({ to: '/mcp' })}
            >
              Open MCP page →
            </button>
          </div>

          {!isLoading && !notDetected && toolsets.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
              {toolsets.slice(0, 5).map((ts) => (
                <span
                  key={ts.name}
                  style={{
                    fontSize: '11px',
                    fontFamily: 'var(--m-font-mono)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'var(--m-bg-alt, var(--m-surface))',
                    border: '1px solid var(--m-border)',
                    color: ts.enabled ? 'var(--m-accent)' : 'var(--m-text-faint)',
                  }}
                >
                  {ts.label ?? ts.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </SettingCard>
    </div>
  )
}
