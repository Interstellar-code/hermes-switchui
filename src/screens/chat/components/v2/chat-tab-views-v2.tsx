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

type RootLevelResult = {
  toolCallId: string
  toolName?: string
  isError?: boolean
  output: string
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
        output,
      })
    }
  }

  // Second pass: build entries from toolCall content blocks
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue
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
        timestamp: m.timestamp,
      })
    }
  }

  return entries
}

/** Extract completed tool calls embedded on a finished assistant message */
function extractStreamToolCallsFromMessages(messages: Array<ChatMessage>): Array<FlatToolEntry> {
  const entries: Array<FlatToolEntry> = []
  for (const m of messages) {
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
    if (!list) continue
    // Defensive: if the enclosing message has finished streaming OR was
    // loaded from history, treat non-error tool calls as settled even when
    // their phase string is 'start'/'calling'. Upstream (Responses API →
    // tool event translation in src/routes/api/send-stream.ts) intentionally
    // swallows tool.completed for some tools, leaving phase stuck. History
    // messages have no __streamingStatus, so any history-shape entry is
    // settled by definition.
    const messageSettled =
      mAny.__streamingStatus === 'complete' || Array.isArray(historyList)
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
        timestamp: typeof m.timestamp === 'number' ? m.timestamp : undefined,
      })
    }
  }
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

export function ToolTabView({ messages, streamingToolCalls = [] }: ToolTabViewProps) {
  const streamingEntries = extractStreamingEntries(streamingToolCalls)
  const completedEntries = extractStreamToolCallsFromMessages(messages)
  const messageEntries = extractToolEntries(messages)
  const entries = mergeToolEntries(streamingEntries, completedEntries, messageEntries)

  if (entries.length === 0) {
    return (
      <div
        className="flex-1 min-h-0 overflow-y-auto p-4 font-mono text-xs"
        style={toolViewStyle}
      >
        <p className="opacity-40 text-center mt-8">No tool invocations yet</p>
      </div>
    )
  }

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2 font-mono text-xs"
      style={toolViewStyle}
    >
      {entries.map((entry) => (
        <ExpandableToolCard key={entry.key} entry={entry} />
      ))}
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
