import { memo, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import {
  detectToolError,
  isMcpToolEntry,
  mcpServerOf,
  unwrapToolInput,
} from './tool-entries'
import { relativeTime } from './tool-panel-v2'
import type { FlatToolEntry } from './tool-entries'

export type McpPanelServer = {
  name: string
  status?: string
  lastError?: string
  enabled?: boolean
}

export type McpServerGroup = {
  server: string
  calls: number
  errors: number
  tools: Array<{ tool: string; count: number }>
  lastError?: string
  lastTs?: number
}

const isLoadCall = (name: string) => {
  const n = name.toLowerCase()
  return n === 'load_mcp_tools' || n === 'load_mcp_server'
}

const norm = (s: string) => s.toLowerCase().replaceAll('-', '_')

function toolLabel(name: string, server: string): string {
  const lower = name.toLowerCase()
  if (lower.startsWith('mcp__')) {
    const rest = lower.split('__').slice(2).join('__')
    return rest || name
  }
  const prefix = `mcp_${norm(server)}_`
  return lower.startsWith(prefix) ? lower.slice(prefix.length) : name
}

function entryIsError(e: FlatToolEntry): boolean {
  return e.isError ?? detectToolError(e.output, e.name, e.input)
}

function firstErrorLine(output?: string): string | undefined {
  const text = output?.trim()
  if (!text) return undefined
  if (text.startsWith('{')) {
    try {
      const err = (JSON.parse(text) as { error?: unknown }).error
      if (typeof err === 'string' && err.trim())
        return err.trim().split('\n')[0]
    } catch {
      // fall through to raw first line
    }
  }
  return text.split('\n')[0]
}

/**
 * Group MCP tool calls (excluding load_mcp_*) by server. Errors first, then
 * calls. `toolServers` maps bare (unprefixed) MCP tool names, lower-cased, to
 * their server.
 */
export function groupMcpByServer(
  entries: ReadonlyArray<FlatToolEntry>,
  serverNames: ReadonlyArray<string>,
  toolServers?: ReadonlyMap<string, string>,
): Array<McpServerGroup> {
  const toolNames = toolServers ? new Set(toolServers.keys()) : undefined
  const map = new Map<string, McpServerGroup & { errTs: number }>()
  for (const e of entries) {
    if (!isMcpToolEntry(e, toolNames) || isLoadCall(e.name)) continue
    let server = mcpServerOf(e.name, serverNames)
    if (server === 'other')
      server = toolServers?.get(e.name.toLowerCase())?.toLowerCase() ?? 'other'
    let g = map.get(server)
    if (!g) {
      g = { server, calls: 0, errors: 0, tools: [], errTs: -1 }
      map.set(server, g)
    }
    g.calls++
    const label = toolLabel(e.name, server)
    const t = g.tools.find((x) => x.tool === label)
    if (t) t.count++
    else g.tools.push({ tool: label, count: 1 })
    const ts = e.displayTs ?? e.timestamp
    if (e.displayTs !== undefined && e.displayTs > (g.lastTs ?? -1))
      g.lastTs = e.displayTs
    if (entryIsError(e)) {
      g.errors++
      // latest errored call wins; later entries win ties
      const order = ts ?? 0
      if (order >= g.errTs) {
        g.errTs = order
        g.lastError = firstErrorLine(e.output)
      }
    }
  }
  return [...map.values()]
    .map(({ errTs: _errTs, ...g }) => g)
    .sort(
      (a, b) =>
        Number(b.errors > 0) - Number(a.errors > 0) ||
        b.calls - a.calls ||
        a.server.localeCompare(b.server),
    )
}

export function mcpServerCount(
  entries: ReadonlyArray<FlatToolEntry>,
  serverNames: ReadonlyArray<string>,
  toolServers?: ReadonlyMap<string, string>,
): number {
  return groupMcpByServer(entries, serverNames, toolServers).length
}

function loadedServers(entries: ReadonlyArray<FlatToolEntry>): Array<string> {
  const out = new Set<string>()
  for (const e of entries) {
    if (!isLoadCall(e.name)) continue
    const input = unwrapToolInput(e.input)
    for (const key of ['server_names', 'tool_names']) {
      const v = input?.[key]
      if (Array.isArray(v))
        for (const s of v) if (typeof s === 'string') out.add(s)
    }
  }
  return [...out]
}

function statusChip(
  s?: McpPanelServer,
): { label: string; color: string } | null {
  if (!s) return null
  if (s.enabled === false)
    return { label: 'disabled', color: 'var(--theme-muted)' }
  if (s.status === 'connected')
    return { label: 'connected', color: 'var(--theme-success, #22c55e)' }
  if (s.status === 'failed')
    return { label: 'failed', color: 'var(--theme-danger, #ef4444)' }
  return null
}

const NO_SERVERS: ReadonlyArray<McpPanelServer> = []

const pill: React.CSSProperties = {
  border: '1px solid var(--theme-border)',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 11,
}

function McpPanelV2Inner({
  entries,
  servers = NO_SERVERS,
  toolServers,
}: {
  entries: ReadonlyArray<FlatToolEntry>
  servers?: ReadonlyArray<McpPanelServer>
  /** Bare MCP tool name (lower-case) → server name. */
  toolServers?: ReadonlyMap<string, string>
}) {
  const names = useMemo(() => servers.map((s) => s.name), [servers])
  const groups = useMemo(
    () => groupMcpByServer(entries, names, toolServers),
    [entries, names, toolServers],
  )
  const loaded = useMemo(() => loadedServers(entries), [entries])
  const byName = useMemo(
    () => new Map(servers.map((s) => [s.name.toLowerCase(), s])),
    [servers],
  )

  return (
    <section
      aria-label="MCP servers"
      className="flex w-full min-w-0 flex-col gap-2 p-2 text-sm"
      style={{ color: 'var(--theme-text)' }}
    >
      {loaded.length > 0 && (
        <p
          className="break-words text-xs"
          style={{ color: 'var(--theme-muted)' }}
        >
          Loaded this session: {loaded.join(', ')}
        </p>
      )}
      {groups.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--theme-muted)' }}>
          No MCP calls in this session
        </p>
      ) : (
        <>
          <h3
            className="m-0 text-[10px] font-medium uppercase tracking-[0.16em]"
            style={{ color: 'var(--theme-muted)' }}
          >
            Used this session
          </h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {groups.map((g) => {
              const srv = byName.get(g.server)
              const chip = statusChip(srv)
              const err =
                g.errors > 0 ? (g.lastError ?? srv?.lastError) : undefined
              const when = g.lastTs ? relativeTime(g.lastTs) : undefined
              return (
                <li
                  key={g.server}
                  className="flex flex-col gap-1.5 rounded-lg border p-2"
                  style={{
                    borderColor: 'var(--theme-border)',
                    background: 'var(--theme-card)',
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-medium">{g.server}</span>
                    {chip && (
                      <span
                        style={{
                          ...pill,
                          color: chip.color,
                          borderColor: chip.color,
                        }}
                      >
                        {chip.label}
                      </span>
                    )}
                    <span
                      className="text-xs"
                      style={{ color: 'var(--theme-muted)' }}
                    >
                      ×{g.calls}
                    </span>
                    {g.errors > 0 && (
                      <span
                        className="text-xs"
                        style={{ color: 'var(--theme-danger, #ef4444)' }}
                      >
                        {g.errors} {g.errors === 1 ? 'error' : 'errors'}
                      </span>
                    )}
                    {when && (
                      <span
                        className="ml-auto text-xs"
                        style={{ color: 'var(--theme-muted)' }}
                      >
                        {when}
                      </span>
                    )}
                  </div>
                  <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
                    {g.tools.map((t) => (
                      <li
                        key={t.tool}
                        style={{ ...pill, color: 'var(--theme-muted)' }}
                      >
                        {t.tool} ×{t.count}
                      </li>
                    ))}
                  </ul>
                  {err && (
                    <p
                      className="m-0 break-words text-xs"
                      style={{ color: 'var(--theme-danger, #ef4444)' }}
                    >
                      {err}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      <Link
        to="/mcp"
        className="text-xs underline"
        style={{ color: 'var(--theme-accent, #6366f1)' }}
      >
        Manage servers on the MCP page →
      </Link>
    </section>
  )
}

export const McpPanelV2 = memo(McpPanelV2Inner)
