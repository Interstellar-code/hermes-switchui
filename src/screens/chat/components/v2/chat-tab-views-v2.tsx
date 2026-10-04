import { useMemo, useState } from 'react'
import { formatStreamingActivityLabel } from '../streaming-activity-ui'
import {
  buildResultTsMap,
  categorizeEntry,
  extractStreamToolCallsFromMessages,
  extractStreamingEntries,
  extractToolEntries,
  filterToolEntries,
  mergeToolEntries,
  readTodoItems,
  unwrapToolInput,
} from './tool-entries'
import type {
  FlatToolEntry,
  StreamingToolCall,
  TodoItem,
  ToolHistoryView,
} from './tool-entries'
import type { ChatMessage } from '../../types'

export {
  buildResultTsMap,
  detectToolError,
  extractStreamToolCallsFromMessages,
  extractStreamingEntries,
  extractToolEntries,
  filterToolEntries,
  isFileToolEntry,
  isMcpToolEntry,
  latestTodoSnapshot,
  mcpServerOf,
  mergeToolEntries,
} from './tool-entries'
export type { FlatToolEntry, ToolHistoryView } from './tool-entries'

type ToolTabViewProps = {
  messages?: Array<ChatMessage>
  streamingToolCalls?: Array<StreamingToolCall>
  view?: ToolHistoryView
  mcpToolNames?: ReadonlySet<string>
}

const toolViewStyle: React.CSSProperties = {
  color: 'var(--m-muted, var(--theme-muted))',
}
const cardStyle: React.CSSProperties = {
  background: 'var(--m-surface-1, var(--theme-card))',
  borderColor: 'var(--m-border, var(--theme-border))',
}
const greenStyle: React.CSSProperties = { color: 'var(--m-green-500)' }
const NO_STREAMING_CALLS: Array<StreamingToolCall> = []
const NO_MESSAGES: Array<ChatMessage> = []

function TodoChecklist({ items }: { items: Array<TodoItem> }) {
  return (
    <div>
      <div className="m-label mb-1 opacity-50" style={{ color: 'var(--theme-muted)' }}>
        To-dos
      </div>
      <ul className="space-y-1.5">
        {items.map((item, index) => {
          const complete = item.status === 'completed'
          const inProgress = item.status === 'in_progress'
          const label = item.status.replaceAll('_', ' ')
          const color = complete
            ? 'var(--theme-success, #22c55e)'
            : inProgress
              ? 'var(--theme-accent, #6366f1)'
              : 'var(--theme-muted)'
          return (
            <li key={`${item.content}-${index}`} className="flex items-start gap-2">
              <span aria-label={label} style={{ color }}>{complete ? '✓' : inProgress ? '◐' : '○'}</span>
              <span className={`min-w-0 break-words ${complete ? 'line-through opacity-50' : ''}`}>{item.content}</span>
              <span className="m-label ml-auto shrink-0 opacity-50" style={{ color }}>{label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function statusBadge(entry: FlatToolEntry) {
  if (entry.isError) return { label: 'error', color: 'var(--theme-danger, #ef4444)' }
  if (entry.output !== undefined) return { label: 'done', color: 'var(--theme-success, #22c55e)' }
  return { label: 'running', color: 'var(--theme-accent, #6366f1)' }
}

function readableWords(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function readableToolName(name: string, input?: Record<string, unknown>): string {
  const lower = name.toLowerCase()
  if (lower === 'load_mcp_tools') return 'Load MCP tools'
  if (lower === 'load_mcp_server') return 'Load MCP server'
  if (lower.startsWith('mcp__')) {
    const [, server = 'server', ...tool] = name.split('__')
    return `MCP · ${readableWords(server)} · ${readableWords(tool.join(' ') || 'tool')}`
  }
  return formatStreamingActivityLabel(name, input)
}

function inputLabel(key: string): string {
  const labels: Record<string, string> = {
    command: 'Command',
    cmd: 'Command',
    file_path: 'File',
    path: 'Path',
    target_file: 'File',
    query: 'Query',
    q: 'Query',
    url: 'URL',
    prompt: 'Prompt',
    pattern: 'Pattern',
    name: 'Name',
    action: 'Action',
    tool_names: 'MCP tools',
    server_names: 'MCP servers',
  }
  return labels[key] ?? readableWords(key).replace(/^./, (letter) => letter.toUpperCase())
}

function readableInputValue(value: unknown, listItem = false): string | null {
  if (typeof value === 'string') return listItem ? readableWords(value) : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function toolInputRows(input?: Record<string, unknown>): Array<{ label: string; value: string }> {
  const args = unwrapToolInput(input)
  if (!args) return []
  const rows: Array<{ label: string; value: string }> = []
  for (const [key, value] of Object.entries(args)) {
    if (key === 'value') continue
    if (Array.isArray(value)) {
      const values = value
        .map((item) => readableInputValue(item, key === 'tool_names' || key === 'server_names'))
        .filter((item): item is string => item !== null)
      if (values.length) rows.push({ label: inputLabel(key), value: values.join(', ') })
      continue
    }
    const readable = readableInputValue(value)
    if (readable) rows.push({ label: inputLabel(key), value: readable })
  }
  return rows.slice(0, 4)
}

// The <pre> mounts only while open so large raw payloads stay out of the DOM.
function RawDetails({ summary, text, className, color }: { summary: string; text: () => string; className: string; color: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer opacity-50">{summary}</summary>
      {open ? (
        <pre className={`mt-1 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] ${className}`} style={{ color }}>
          {text()}
        </pre>
      ) : null}
    </details>
  )
}

function RawToolDetails({ entry }: { entry: FlatToolEntry }) {
  return (
    <div className="mt-2 space-y-1.5">
      {entry.input && Object.keys(entry.input).length > 0 ? (
        <RawDetails
          summary="Raw input"
          text={() => JSON.stringify(entry.input, null, 2)}
          className="max-h-32"
          color="var(--code-foreground, var(--theme-text))"
        />
      ) : null}
      {entry.output !== undefined && entry.output !== '' ? (
        <RawDetails
          summary={`Raw ${entry.isError ? 'error' : 'output'}`}
          text={() => entry.output ?? ''}
          className="max-h-48"
          color={entry.isError ? 'var(--theme-danger, #ef4444)' : 'var(--code-foreground, var(--theme-text))'}
        />
      ) : null}
    </div>
  )
}

function HumanToolDetails({ entry, todoItems }: { entry: FlatToolEntry; todoItems: Array<TodoItem> }) {
  const rows = toolInputRows(entry.input)
  const hasOutput = entry.output !== undefined && entry.output !== ''

  return (
    <>
      {todoItems.length > 0 ? <TodoChecklist items={todoItems} /> : null}
      {rows.length > 0 ? (
        <dl className={todoItems.length > 0 ? 'mt-2 space-y-1' : 'space-y-1'}>
          {rows.map((row) => (
            <div key={row.label} className="flex items-start gap-2">
              <dt className="m-label shrink-0 opacity-50" style={{ color: 'var(--theme-muted)' }}>{row.label}</dt>
              <dd className="min-w-0 break-words" style={{ color: 'var(--code-foreground, var(--theme-text))' }}>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {hasOutput ? (
        <div className={todoItems.length > 0 || rows.length > 0 ? 'mt-2' : ''}>
          <div className="m-label mb-0.5 opacity-50" style={{ color: entry.isError ? 'var(--theme-danger, #ef4444)' : 'var(--theme-muted)' }}>
            {entry.isError ? 'Error' : 'Result'}
          </div>
          <div className="max-h-32 overflow-auto whitespace-pre-wrap break-words" style={{ color: entry.isError ? 'var(--theme-danger, #ef4444)' : 'var(--code-foreground, var(--theme-text))' }}>
            {entry.output}
          </div>
        </div>
      ) : null}
      {todoItems.length === 0 && rows.length === 0 && !hasOutput ? (
        <div className="font-sans text-[9px] opacity-40 italic">no details available</div>
      ) : null}
      <RawToolDetails entry={entry} />
    </>
  )
}

function ExpandableToolCard({ entry }: { entry: FlatToolEntry }) {
  const [open, setOpen] = useState(false)
  const badge = statusBadge(entry)
  const hasInput = !!(entry.input && Object.keys(entry.input).length > 0)
  const hasOutput = entry.output !== undefined && entry.output !== ''
  const todoItems = entry.name.toLowerCase() === 'todo' ? readTodoItems(entry.input) : []
  // canExpand: allow inspection whenever there's input, output, or call is settled (done/error)
  const canExpand = hasInput || hasOutput || badge.label === 'done' || badge.label === 'error'
  const displayName = readableToolName(entry.name, unwrapToolInput(entry.input))

  return (
    <div
      className="rounded border overflow-hidden"
      style={cardStyle}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => canExpand && setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (canExpand && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            setOpen((v) => !v)
          }
        }}
        className="m-mono flex w-full items-center gap-2 px-3 py-2 text-left"
        style={{ cursor: canExpand ? 'pointer' : 'default', background: 'transparent', border: 'none' }}
      >
        <span style={greenStyle}>{open ? '▼' : '▶'}</span>
        <span className="min-w-0 truncate font-semibold" style={greenStyle} title={displayName}>{displayName}</span>
        {entry.callId ? (
          <span className="opacity-40 truncate min-w-0 text-[10px]">{entry.callId}</span>
        ) : null}
        <span className="flex-1" />
        {entry.displayTs ? (
          <span
            className="m-timestamp shrink-0 opacity-40"
            title={new Date(entry.displayTs).toLocaleString()}
          >
            {new Date(entry.displayTs).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        ) : null}
        <span
          className="m-label shrink-0 px-1.5 py-0.5 rounded"
          style={{
            color: badge.color,
            background: `color-mix(in srgb, ${badge.color} 15%, transparent)`,
          }}
        >
          {badge.label}
        </span>
        {canExpand ? (
          <span className="shrink-0 opacity-40 text-[10px]">{open ? '▾' : '▸'}</span>
        ) : null}
      </button>
      {open && canExpand ? (
        <div
          className="mx-3 mb-2 rounded border px-3 py-2 text-[11px]"
          style={{
            background: 'var(--code-bg, color-mix(in srgb, var(--theme-card) 70%, transparent))',
            borderColor: 'var(--theme-border)',
          }}
        >
          <HumanToolDetails entry={entry} todoItems={todoItems} />
        </div>
      ) : null}
    </div>
  )
}

type MixedRow =
  | { kind: 'tool'; entry: FlatToolEntry; ts: number }
  | { kind: 'gap'; minutes: number; id: string }

function buildMixedRows(entries: Array<FlatToolEntry>): Array<MixedRow> {
  // Sort tool entries chronologically (stable — entries without timestamps last)
  const sortedEntries = [...entries].sort(
    (a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity),
  )

  const rows: Array<MixedRow> = []
  let prevTs: number | null = null
  for (const entry of sortedEntries) {
    const ts = entry.timestamp ?? Infinity
    if (prevTs !== null && ts !== Infinity && ts - prevTs > 60_000) {
      const minutes = Math.round((ts - prevTs) / 60_000)
      rows.push({ kind: 'gap', minutes, id: `gap-${prevTs}-${ts}` })
    }
    rows.push({ kind: 'tool', entry, ts })
    if (ts !== Infinity) prevTs = ts
  }
  return rows
}

const filterPillStyle = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--m-green-500)' : 'transparent',
  border: `1px solid ${active ? 'var(--m-green-500)' : 'var(--m-border, var(--theme-border))'}`,
  color: active ? 'var(--theme-bg, #000)' : 'var(--m-muted, var(--theme-muted))',
  borderRadius: '9999px',
  padding: '1px 8px',
  fontSize: '9px',
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
})

export function ToolTabView({
  messages = NO_MESSAGES,
  streamingToolCalls = NO_STREAMING_CALLS,
  view = 'all',
  mcpToolNames,
}: ToolTabViewProps) {
  const [filter, setFilter] = useState<string>('all')
  const [sortDir, setSortDir] = useState<'oldest' | 'newest'>('oldest')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const entries = useMemo(
    () =>
      mergeToolEntries(
        extractStreamingEntries(streamingToolCalls),
        extractStreamToolCallsFromMessages(messages, buildResultTsMap(messages)),
        extractToolEntries(messages),
      ),
    [messages, streamingToolCalls],
  )

  const scopedEntries = useMemo(
    () => filterToolEntries(entries, view, mcpToolNames),
    [entries, mcpToolNames, view],
  )
  const allRows = useMemo(() => buildMixedRows(scopedEntries), [scopedEntries])

  // Derive the set of categories present in the current tool entries
  const categoriesPresent = useMemo(
    () => Array.from(new Set(scopedEntries.map((e) => categorizeEntry(e, mcpToolNames)))).sort(),
    [mcpToolNames, scopedEntries],
  )
  const q = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery])
  const filteredRows = useMemo(() => {
    const matchesQuery = (row: typeof allRows[number]): boolean => {
      if (!q) return true
      if (row.kind === 'tool') {
        const e = row.entry
        const hay =
          `${e.name} ${e.callId} ${e.input ? JSON.stringify(e.input) : ''} ${e.output ?? ''}`.toLowerCase()
        return hay.includes(q)
      }
      return true
    }
    return allRows.filter((row) => {
      if (!matchesQuery(row)) return false
      if (filter === 'all') return true
      if (row.kind === 'tool') return categorizeEntry(row.entry, mcpToolNames) === filter
      return false
    })
  }, [allRows, filter, mcpToolNames, q])
  const visibleRows = useMemo(
    () => (sortDir === 'newest' ? [...filteredRows].reverse() : filteredRows),
    [filteredRows, sortDir],
  )

  const isEmpty = scopedEntries.length === 0
  const noMatches = !isEmpty && !visibleRows.some((row) => row.kind !== 'gap')
  const emptyMessage =
    view === 'todos'
      ? 'No to-do tool calls yet'
      : view === 'mcp'
        ? 'No MCP tool calls yet'
        : view === 'files'
          ? 'No file activity yet'
        : 'No tool invocations yet'

  return (
    <div className="m-mono flex-1 min-h-0 overflow-y-auto flex flex-col" style={toolViewStyle}>
      {/* Filter pill row + sort */}
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-2 shrink-0 flex-wrap">
        {(['all', ...categoriesPresent] as const).map((f) => (
          <button
            key={f}
            type="button"
            style={filterPillStyle(filter === f)}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-1.5">
          {searchOpen ? (
            <input
              autoFocus
              type="text"
              aria-label="Search tool calls"
              value={searchQuery}
              placeholder="search…"
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  // Clear search without letting the panel's Esc handler close it.
                  e.preventDefault()
                  e.stopPropagation()
                  setSearchQuery('')
                  setSearchOpen(false)
                }
              }}
              className="w-32 min-w-0 flex-1"
              style={{
                ...filterPillStyle(false),
                padding: '1px 8px',
                outline: 'none',
              }}
            />
          ) : null}
          <button
            type="button"
            aria-label={searchOpen ? 'Close search' : 'Open search'}
            style={filterPillStyle(searchOpen || !!q)}
            onClick={() => {
              if (searchOpen) {
                setSearchQuery('')
                setSearchOpen(false)
              } else {
                setSearchOpen(true)
              }
            }}
          >
            {searchOpen ? '×' : '⌕'}
          </button>
          <button
            type="button"
            aria-label={`Sort ${sortDir}`}
            style={filterPillStyle(false)}
            onClick={() => setSortDir((s) => (s === 'oldest' ? 'newest' : 'oldest'))}
          >
            {sortDir === 'oldest' ? '↑ oldest' : '↓ newest'}
          </button>
        </div>
      </div>

      {isEmpty || noMatches ? (
        <div className="flex-1 flex items-start justify-center pt-8 p-4">
          <p className="opacity-40 text-center">{isEmpty ? emptyMessage : 'No matches for this filter'}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 p-4 pt-1 space-y-2">
          {visibleRows.map((row) => {
            if (row.kind === 'gap') {
              return (
                <div
                  key={row.id}
                  className="text-center tabular-nums opacity-30"
                  style={{ fontSize: '9px', letterSpacing: '0.05em' }}
                >
                  ··· {row.minutes}m gap ···
                </div>
              )
            }
            return <ExpandableToolCard key={row.entry.key} entry={row.entry} />
          })}
        </div>
      )}
    </div>
  )
}
