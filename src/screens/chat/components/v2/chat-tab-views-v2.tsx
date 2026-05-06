import { useState } from 'react'
import { formatStreamingActivityLabel } from '../streaming-activity-ui'
import type { ChatMessage } from '../../types'

type LifecycleEvent = {
  text: string
  emoji: string
  timestamp: number
  isError: boolean
}

type StreamingToolCall = {
  id: string
  name: string
  phase: string
  args?: unknown
  preview?: string
  result?: string
}

type ToolTabViewProps = {
  messages: Array<ChatMessage>
  streamingToolCalls?: Array<StreamingToolCall>
  events?: Array<LifecycleEvent>
}

/**
 * Categorize a tool entry by inferring its "kind" from arg keys + name.
 * Drives the filter chip row so users filter by purpose rather than tool name.
 */
function categorizeEntry(entry: FlatToolEntry): string {
  const name = (entry.name || '').toLowerCase()

  // Collect input keys, recursing one level into a string-form `value` field
  // when the gateway emits args as `{value: "<json string>"}`.
  let keys: Array<string> = []
  if (entry.input) {
    keys = Object.keys(entry.input).map((k) => k.toLowerCase())
    const v = (entry.input as Record<string, unknown>).value
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v) as Record<string, unknown>
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          keys = keys.concat(Object.keys(parsed).map((k) => k.toLowerCase()))
        }
      } catch {
        /* ignore non-JSON value */
      }
    }
  }

  const has = (...ks: Array<string>) => ks.some((k) => keys.includes(k))
  if (has('command', 'cmd', 'shell') || /\b(exec|bash|terminal|shell|run_command)\b/.test(name)) return 'exec'
  if (has('pattern', 'glob', 'file_glob') || /\bglob\b/.test(name)) return 'glob'
  if (has('query', 'q', 'reasoning_level') || /\b(search|find|grep|query)\b/.test(name)) return 'search'
  if (has('url', 'href') || /\b(web|browser|fetch|http)\b/.test(name)) return 'web'
  if (has('file_path', 'path', 'target_file', 'filepath') || /\b(read|write|edit|file|notebook)\b/.test(name)) return 'file'
  if (/\b(skill|todo|task)\b/.test(name)) return 'skill'
  if (/\b(honcho|memory|recall|remember|context|profile|reasoning)\b/.test(name)) return 'memory'
  if (has('job_id', 'schedule', 'repeat') || /\bcron\b/.test(name)) return 'cron'
  return 'other'
}

type ActivityTabViewProps = {
  events: Array<LifecycleEvent>
  messages?: Array<ChatMessage>
  streamingToolCalls?: Array<StreamingToolCall>
}

const toolViewStyle: React.CSSProperties = {
  color: 'var(--m-muted, var(--theme-muted))',
}
const cardStyle: React.CSSProperties = {
  background: 'var(--m-surface-1, var(--theme-card))',
  borderColor: 'var(--m-border, var(--theme-border))',
}
const greenStyle: React.CSSProperties = { color: 'var(--m-green, #4ade80)' }

type FlatToolEntry = {
  key: string
  isCall: boolean
  name: string
  callId: string
  input?: Record<string, unknown>
  output?: string
  isError?: boolean
  timestamp?: number
}

/**
 * Read a usable timestamp off a chat message. Tries createdAt, timestamp
 * (number or ISO string), then __receiveTime. Returns undefined if none.
 * Mirrors chat-store.ts:444-466.
 */
function getMessageTimestamp(m: ChatMessage): number | undefined {
  const raw = m as unknown as Record<string, unknown>
  for (const key of ['createdAt', 'timestamp']) {
    const v = raw[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim().length > 0) {
      const parsed = Date.parse(v)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  const r = raw.__receiveTime
  if (typeof r === 'number' && Number.isFinite(r)) return r
  return undefined
}

type RootLevelResult = {
  toolCallId: string
  toolName?: string
  isError?: boolean
  output: string
  timestamp?: number
}

/** Determine phase → status. Canonical mapping per v1 message-item.tsx:376-389. */
function phaseToStatus(phase: string): 'running' | 'done' | 'error' {
  if (phase === 'error' || phase === 'failed' || phase === 'failure') return 'error'
  if (
    phase === 'done' ||
    phase === 'result' ||
    phase === 'complete' ||
    phase === 'completed'
  )
    return 'done'
  if (phase === 'start' || phase === 'started' || phase === 'calling' || phase === 'running')
    return 'running'
  // Unknown phases default to running, matching v1 message-item.tsx:389.
  return 'running'
}

/** Build FlatToolEntry list from streaming tool calls */
function extractStreamingEntries(
  streamingToolCalls: Array<StreamingToolCall>,
): Array<FlatToolEntry> {
  return streamingToolCalls.map((tc) => {
    const status = phaseToStatus(tc.phase)
    const input =
      tc.args && typeof tc.args === 'object' && !Array.isArray(tc.args)
        ? (tc.args as Record<string, unknown>)
        : tc.args !== undefined
          ? { value: tc.args }
          : undefined
    // Use result field for output; empty string is valid (shows 'done' with empty body)
    const output = status !== 'running' ? (tc.result ?? '') : undefined
    return {
      key: tc.id,
      isCall: true,
      name: tc.name,
      callId: tc.id,
      input,
      output,
      isError: status === 'error',
    }
  })
}

function extractToolEntries(messages: Array<ChatMessage>): Array<FlatToolEntry> {
  const entries: Array<FlatToolEntry> = []
  const resultsByCallId = new Map<string, RootLevelResult>()

  // First pass: collect tool results.
  // Two shapes occur in the wild:
  //   (a) realtime: a separate message with role 'tool'/'toolResult' and a
  //       top-level toolCallId field.
  //   (b) history (claude-api.ts): role 'tool' with a content block of
  //       type 'tool_result' carrying toolCallId; no top-level toolCallId.
  for (const m of messages) {
    const rootToolCallId =
      typeof m.toolCallId === 'string' && m.toolCallId ? m.toolCallId : ''
    if (rootToolCallId) {
      const textOutput = Array.isArray(m.content)
        ? m.content
          .filter((c) => c.type === 'text')
          .map((c) => (c as { text?: string }).text ?? '')
          .join('')
        : ''
      const output = textOutput || (m.details ? JSON.stringify(m.details, null, 2) : '')
      resultsByCallId.set(rootToolCallId, {
        toolCallId: rootToolCallId,
        toolName: typeof m.toolName === 'string' ? m.toolName : undefined,
        isError: m.isError === true,
        output,
        timestamp: getMessageTimestamp(m),
      })
      continue
    }
    if (!Array.isArray(m.content)) continue
    for (const c of m.content) {
      const cAny = c as unknown as Record<string, unknown>
      if (cAny.type !== 'tool_result' && cAny.type !== 'toolResult') continue
      const callId =
        typeof cAny.toolCallId === 'string' ? cAny.toolCallId : ''
      if (!callId) continue
      const text =
        typeof cAny.text === 'string'
          ? cAny.text
          : Array.isArray(cAny.content)
            ? (cAny.content as Array<{ type?: string; text?: string }>)
              .filter((p) => p?.type === 'text')
              .map((p) => p.text ?? '')
              .join('')
            : ''
      const details = cAny.details as Record<string, unknown> | undefined
      const output = text || (details ? JSON.stringify(details, null, 2) : '')
      resultsByCallId.set(callId, {
        toolCallId: callId,
        toolName: typeof cAny.toolName === 'string' ? cAny.toolName : undefined,
        isError: cAny.isError === true,
        timestamp: getMessageTimestamp(m),
        output,
      })
    }
  }

  // Second pass: build entries from toolCall content blocks.
  // Synthesise a strictly-increasing timestamp so order across + within
  // messages is preserved when the message-level timestamp is missing
  // or shared.
  messages.forEach((m, msgIdx) => {
    if (!Array.isArray(m.content)) return
    const baseTs = getMessageTimestamp(m) ?? msgIdx * 1000
    let subIdx = 0
    for (const c of m.content) {
      if (c.type !== 'toolCall') continue
      const callId = c.id ?? ''
      const result = callId ? resultsByCallId.get(callId) : undefined
      entries.push({
        key: callId || `${c.name ?? 'tool'}-${entries.length}`,
        isCall: true,
        name: c.name ?? '',
        callId,
        input: c.arguments,
        output: result ? result.output : undefined,
        isError: result?.isError ?? false,
        timestamp: result?.timestamp ?? baseTs + subIdx * 0.001,
      })
      subIdx++
    }
  })

  return entries
}

/** Extract completed tool calls embedded on a finished assistant message */
function extractStreamToolCallsFromMessages(messages: Array<ChatMessage>): Array<FlatToolEntry> {
  const entries: Array<FlatToolEntry> = []
  messages.forEach((m, msgIdx) => {
    const mAny = m as unknown as Record<string, unknown>
    // Two shapes carry embedded tool-call summaries:
    //   __streamToolCalls — written by chat-store on the realtime 'done' event.
    //   streamToolCalls   — written by claude-api.ts when normalising history
    //                       (server-side history reload). Phase is already
    //                       'complete' on this path.
    const realtimeList = mAny.__streamToolCalls
    const historyList = mAny.streamToolCalls
    const list = Array.isArray(realtimeList)
      ? realtimeList
      : Array.isArray(historyList)
        ? historyList
        : null
    if (!list) return
    const messageSettled =
      mAny.__streamingStatus === 'complete' || Array.isArray(historyList)
    const baseTs = getMessageTimestamp(m) ?? msgIdx * 1000
    let subIdx = 0
    for (const tc of list as Array<StreamingToolCall>) {
      let status = phaseToStatus(tc.phase)
      if (messageSettled && status === 'running') status = 'done'
      const input =
        tc.args && typeof tc.args === 'object' && !Array.isArray(tc.args)
          ? (tc.args as Record<string, unknown>)
          : tc.args !== undefined
            ? { value: tc.args }
            : undefined
      const output = status !== 'running' ? (tc.result ?? '') : undefined
      entries.push({
        key: tc.id || `${tc.name}-${entries.length}`,
        isCall: true,
        name: tc.name,
        callId: tc.id,
        input,
        output,
        isError: status === 'error',
        timestamp: baseTs + subIdx * 0.001,
      })
      subIdx++
    }
  })
  return entries
}

/**
 * Merge tool entries by callId.
 * Default priority (highest → lowest): streaming (in-flight) >
 *   __streamToolCalls (completed snapshot) > message-content.
 * Exception: when the live streaming entry is still 'running' but another
 * source already has a settled entry (output set or error) for the same
 * callId, prefer the settled one. This guards against upstream phase
 * staleness (e.g. Responses API swallowing tool.completed) while the run
 * is still considered active.
 */
function mergeToolEntries(
  streamingEntries: Array<FlatToolEntry>,
  completedEntries: Array<FlatToolEntry>,
  messageEntries: Array<FlatToolEntry>,
): Array<FlatToolEntry> {
  const byCallId = new Map<string, FlatToolEntry>()

  const isSettled = (e: FlatToolEntry) =>
    e.isError === true || e.output !== undefined

  for (const e of messageEntries) {
    const k = e.callId || e.key
    byCallId.set(k, e)
  }

  for (const e of completedEntries) {
    const k = e.callId || e.key
    const existing = byCallId.get(k)
    if (!existing || !isSettled(existing) || isSettled(e)) {
      byCallId.set(k, e)
    }
  }

  for (const e of streamingEntries) {
    const k = e.callId || e.key
    const existing = byCallId.get(k)
    if (existing && isSettled(existing) && !isSettled(e)) continue
    byCallId.set(k, e)
  }

  return Array.from(byCallId.values())
}

function statusBadge(entry: FlatToolEntry) {
  if (entry.isError) return { label: 'error', color: 'var(--theme-danger, #ef4444)' }
  if (entry.output !== undefined) return { label: 'done', color: 'var(--theme-success, #22c55e)' }
  return { label: 'running', color: 'var(--theme-accent, #6366f1)' }
}

function ExpandableToolCard({ entry }: { entry: FlatToolEntry }) {
  const [open, setOpen] = useState(false)
  const badge = statusBadge(entry)
  const hasInput = !!(entry.input && Object.keys(entry.input).length > 0)
  const hasOutput = entry.output !== undefined && entry.output !== ''
  // canExpand: allow inspection whenever there's input, output, or call is settled (done/error)
  const canExpand = hasInput || hasOutput || badge.label === 'done' || badge.label === 'error'
  const displayName = formatStreamingActivityLabel(entry.name, entry.input)

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
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs"
        style={{ cursor: canExpand ? 'pointer' : 'default', background: 'transparent', border: 'none' }}
      >
        <span style={greenStyle}>{open ? '▼' : '▶'}</span>
        <span className="font-semibold" style={greenStyle}>{displayName}</span>
        {entry.callId ? (
          <span className="opacity-40 truncate min-w-0 text-[10px]">{entry.callId}</span>
        ) : null}
        <span className="flex-1" />
        {entry.timestamp ? (
          <span
            className="shrink-0 opacity-40 text-[10px] tabular-nums"
            title={new Date(entry.timestamp).toLocaleString()}
          >
            {new Date(entry.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        ) : null}
        <span
          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded"
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
          {hasInput ? (
            <div>
              <div className="mb-0.5 font-sans text-[9px] uppercase tracking-widest opacity-50" style={{ color: 'var(--theme-muted)' }}>
                Input
              </div>
              <pre
                className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px]"
                style={{ color: 'var(--code-foreground, var(--theme-text))' }}
              >
                {JSON.stringify(entry.input, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="mb-0.5 font-sans text-[9px] opacity-40 italic">no input</div>
          )}
          {hasOutput ? (
            <div className={hasInput ? 'mt-1.5' : ''}>
              <div
                className="mb-0.5 font-sans text-[9px] uppercase tracking-widest opacity-50"
                style={{ color: entry.isError ? 'var(--theme-danger, #ef4444)' : 'var(--theme-muted)' }}
              >
                {entry.isError ? 'Error' : 'Output'}
              </div>
              <pre
                className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px]"
                style={{ color: entry.isError ? 'var(--theme-danger, #ef4444)' : 'var(--code-foreground, var(--theme-text))' }}
              >
                {entry.output}
              </pre>
            </div>
          ) : (
            <div className={`font-sans text-[9px] opacity-40 italic ${hasInput ? 'mt-1.5' : ''}`}>no output</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

type MixedRow =
  | { kind: 'tool'; entry: FlatToolEntry; ts: number }
  | { kind: 'lifecycle'; event: LifecycleEvent; ts: number }
  | { kind: 'gap'; minutes: number; id: string }

function buildMixedRows(
  entries: Array<FlatToolEntry>,
  events: Array<LifecycleEvent>,
): Array<MixedRow> {
  // Sort tool entries chronologically (stable — entries without timestamps last)
  const sortedEntries = [...entries].sort(
    (a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity),
  )

  const items: Array<{ kind: 'tool' | 'lifecycle'; ts: number; entry?: FlatToolEntry; event?: LifecycleEvent }> = [
    ...sortedEntries.map((e) => ({ kind: 'tool' as const, ts: e.timestamp ?? Infinity, entry: e })),
    ...events.map((ev) => ({ kind: 'lifecycle' as const, ts: ev.timestamp, event: ev })),
  ]
  items.sort((a, b) => a.ts - b.ts)

  const rows: Array<MixedRow> = []
  let prevTs: number | null = null
  for (const item of items) {
    if (prevTs !== null && item.ts !== Infinity && item.ts - prevTs > 60_000) {
      const minutes = Math.round((item.ts - prevTs) / 60_000)
      rows.push({ kind: 'gap', minutes, id: `gap-${prevTs}-${item.ts}` })
    }
    if (item.kind === 'tool') {
      rows.push({ kind: 'tool', entry: item.entry!, ts: item.ts })
    } else {
      rows.push({ kind: 'lifecycle', event: item.event!, ts: item.ts })
    }
    if (item.ts !== Infinity) prevTs = item.ts
  }
  return rows
}

const filterPillStyle = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--m-green, #4ade80)' : 'transparent',
  border: `1px solid ${active ? 'var(--m-green, #4ade80)' : 'var(--m-border, var(--theme-border))'}`,
  color: active ? 'var(--theme-bg, #000)' : 'var(--m-muted, var(--theme-muted))',
  borderRadius: '9999px',
  padding: '1px 8px',
  fontSize: '9px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: active ? 600 : 400,
})

export function ToolTabView({ messages, streamingToolCalls = [], events = [] }: ToolTabViewProps) {
  const [filter, setFilter] = useState<string>('all')
  const [sortDir, setSortDir] = useState<'oldest' | 'newest'>('oldest')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const streamingEntries = extractStreamingEntries(streamingToolCalls)
  const completedEntries = extractStreamToolCallsFromMessages(messages)
  const messageEntries = extractToolEntries(messages)
  const entries = mergeToolEntries(streamingEntries, completedEntries, messageEntries)

  const allRows = buildMixedRows(entries, events)

  // Derive the set of categories present in the current tool entries
  const categoriesPresent = Array.from(
    new Set(entries.map((e) => categorizeEntry(e))),
  ).sort()
  const q = searchQuery.trim().toLowerCase()
  const matchesQuery = (row: typeof allRows[number]): boolean => {
    if (!q) return true
    if (row.kind === 'tool') {
      const e = row.entry
      const hay =
        `${e.name} ${e.callId} ${e.input ? JSON.stringify(e.input) : ''} ${e.output ?? ''}`.toLowerCase()
      return hay.includes(q)
    }
    if (row.kind === 'lifecycle') {
      return row.event.text.toLowerCase().includes(q)
    }
    return true
  }
  const filteredRows = allRows.filter((row) => {
    if (!matchesQuery(row)) return false
    if (filter === 'all') return true
    if (filter === 'events') return row.kind !== 'tool'
    if (row.kind === 'tool') return categorizeEntry(row.entry) === filter
    return false
  })
  const visibleRows = sortDir === 'newest' ? [...filteredRows].reverse() : filteredRows

  const isEmpty = entries.length === 0 && events.length === 0

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col font-mono text-xs" style={toolViewStyle}>
      {/* Filter pill row + sort */}
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-2 shrink-0 flex-wrap">
        {(['all', ...categoriesPresent, 'events'] as const).map((f) => (
          <button
            key={f}
            type="button"
            style={filterPillStyle(filter === f)}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
        <div style={{ marginLeft: 'auto' }} className="flex items-center gap-1.5">
          {searchOpen ? (
            <input
              autoFocus
              type="text"
              value={searchQuery}
              placeholder="search…"
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchQuery('')
                  setSearchOpen(false)
                }
              }}
              style={{
                ...filterPillStyle(false),
                padding: '1px 8px',
                width: 140,
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

      {isEmpty ? (
        <div className="flex-1 flex items-start justify-center pt-8 p-4">
          <p className="opacity-40 text-center">No tool invocations yet</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 p-4 pt-1 space-y-2">
          {visibleRows.map((row, i) => {
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
            if (row.kind === 'lifecycle') {
              const ev = row.event
              return (
                <div key={`lc-${i}`} className="flex items-center gap-2" style={{ fontSize: '9px' }}>
                  <ActivityDot isError={ev.isError} />
                  <span className={ev.isError ? 'text-red-400 shrink-0' : 'opacity-70 shrink-0'}>
                    {ev.text}
                  </span>
                  <span className="opacity-40 ml-auto shrink-0 tabular-nums">
                    {new Date(ev.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
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

// --- Activity Tab ---

type ActivityRow =
  | { kind: 'lifecycle'; event: LifecycleEvent }
  | { kind: 'tool'; entry: FlatToolEntry }

function buildActivityRows(
  events: Array<LifecycleEvent>,
  messages: Array<ChatMessage>,
  streamingToolCalls: Array<StreamingToolCall>,
): Array<ActivityRow> {
  const rows: Array<ActivityRow> = []

  for (const ev of events) {
    rows.push({ kind: 'lifecycle', event: ev })
  }

  const streamingEntries = extractStreamingEntries(streamingToolCalls)
  const completedEntries = extractStreamToolCallsFromMessages(messages)
  const messageEntries = extractToolEntries(messages)
  const toolEntries = mergeToolEntries(streamingEntries, completedEntries, messageEntries)
  for (const entry of toolEntries) {
    rows.push({ kind: 'tool', entry })
  }

  // Sort chronologically; tool entries without timestamps go after lifecycle events
  rows.sort((a, b) => {
    const ta = a.kind === 'lifecycle' ? a.event.timestamp : (a.entry.timestamp ?? Infinity)
    const tb = b.kind === 'lifecycle' ? b.event.timestamp : (b.entry.timestamp ?? Infinity)
    return ta - tb
  })

  return rows
}

function ActivityDot({ isError, isRunning }: { isError?: boolean; isRunning?: boolean }) {
  const color = isError
    ? 'var(--theme-danger, #ef4444)'
    : isRunning
      ? 'var(--theme-accent, #6366f1)'
      : 'var(--theme-success, #22c55e)'
  return (
    <span
      className="shrink-0 size-1.5 rounded-full mt-1.5"
      style={{ background: color, display: 'inline-block' }}
    />
  )
}

export function ActivityTabView({ events, messages = [], streamingToolCalls = [] }: ActivityTabViewProps) {
  const rows = buildActivityRows(events, messages, streamingToolCalls)

  if (rows.length === 0) {
    return (
      <div
        className="flex-1 min-h-0 overflow-y-auto p-4 font-mono text-xs"
        style={toolViewStyle}
      >
        <p className="opacity-40 text-center mt-8">No activity events yet</p>
      </div>
    )
  }

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto p-4 space-y-1.5 font-mono text-xs"
      style={toolViewStyle}
    >
      {rows.map((row, i) => {
        if (row.kind === 'lifecycle') {
          const ev = row.event
          return (
            <div key={`lc-${i}`} className="flex items-start gap-2">
              <ActivityDot isError={ev.isError} />
              <span className={ev.isError ? 'text-red-400 shrink-0' : 'opacity-80 shrink-0'}>
                {ev.text}
              </span>
              <span className="opacity-40 ml-auto shrink-0 tabular-nums">
                {new Date(ev.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            </div>
          )
        }
        const entry = row.entry
        const badge = statusBadge(entry)
        const displayName = formatStreamingActivityLabel(entry.name, entry.input)
        return (
          <div key={`tool-${entry.key}`} className="flex items-start gap-2">
            <ActivityDot isError={entry.isError} isRunning={badge.label === 'running'} />
            <span className="opacity-80 shrink-0">
              tool · <span style={greenStyle}>{displayName}</span> ·{' '}
              <span style={{ color: badge.color }}>{badge.label}</span>
            </span>
            {entry.timestamp ? (
              <span className="opacity-40 ml-auto shrink-0 tabular-nums">
                {new Date(entry.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
