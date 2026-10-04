/**
 * Pure tool-entry derivation shared by the chat tool views and the header
 * counts. No React here: messages + live tool calls in, FlatToolEntry out.
 */
import type { ChatMessage } from '../../types'

export type StreamingToolCall = {
  id: string
  name: string
  phase: string
  args?: unknown
  preview?: string
  result?: string
  firstSeenAt?: number
}

export type ToolHistoryView = 'all' | 'todos' | 'mcp' | 'files'

export type FlatToolEntry = {
  key: string
  isCall: boolean
  name: string
  callId: string
  input?: Record<string, unknown>
  output?: string
  isError?: boolean
  /**
   * Sort-order timestamp — may be a synthesised parent-message offset.
   * Do NOT display this directly; use displayTs instead.
   */
  timestamp?: number
  /**
   * Display timestamp — only set when the timestamp is reliably per-tool-call:
   *   • firstSeenAt from the SSE stream (live runs)
   *   • result-message timestamp (when a tool result message exists in history)
   * Absent for old/history sessions where the gateway never persisted per-tool time.
   */
  displayTs?: number
}

export type TodoItem = {
  content: string
  status: string
}

export type TodoSnapshot = {
  todos: Array<TodoItem>
  summary?: Record<string, unknown>
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonRecord(
  text: string | undefined,
): Record<string, unknown> | undefined {
  if (!text) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** Gateway arguments may be wrapped as `{ value: "{...}" }`. */
export function unwrapToolInput(
  input?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!input || typeof input.value !== 'string') return input
  return parseJsonRecord(input.value) ?? input
}

export function readTodoItems(
  input?: Record<string, unknown>,
): Array<TodoItem> {
  const payload = unwrapToolInput(input)
  if (!payload) return []
  const todos = payload.todos
  if (!Array.isArray(todos)) return []
  return todos.flatMap((todo) => {
    if (!isRecord(todo)) return []
    const { content, status } = todo
    return typeof content === 'string' && content.trim()
      ? [
          {
            content: content.trim(),
            status: typeof status === 'string' ? status : 'pending',
          },
        ]
      : []
  })
}

function nameTokens(name: string): Array<string> {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Categorize a tool entry by inferring its "kind" from arg keys + name tokens.
 * Drives the filter chip row so users filter by purpose rather than tool name.
 */
export function categorizeEntry(
  entry: FlatToolEntry,
  mcpToolNames?: ReadonlySet<string>,
): string {
  const name = (entry.name || '').toLowerCase()
  const tokens = nameTokens(name)
  const keys = new Set(
    Object.keys(unwrapToolInput(entry.input) ?? {})
      .concat(Object.keys(entry.input ?? {}))
      .map((k) => k.toLowerCase()),
  )

  const has = (...ks: Array<string>) => ks.some((k) => keys.has(k))
  const named = (...ts: Array<string>) => ts.some((t) => tokens.includes(t))
  if (isMcpToolEntry(entry, mcpToolNames)) return 'mcp'
  if (named('code')) return 'code'
  if (
    has('command', 'cmd', 'shell') ||
    named('exec', 'bash', 'terminal', 'shell', 'command')
  )
    return 'exec'
  if (has('pattern', 'glob', 'file_glob') || named('glob')) return 'glob'
  if (
    has('query', 'q', 'reasoning_level') ||
    named('search', 'find', 'grep', 'rg', 'query')
  )
    return 'search'
  if (has('url', 'href') || named('web', 'browser', 'fetch', 'http'))
    return 'web'
  if (
    has('file_path', 'path', 'target_file', 'filepath') ||
    named('read', 'write', 'edit', 'patch', 'file', 'files', 'notebook')
  )
    return 'file'
  // Strict skill system tools per Hermes Agent canonical taxonomy
  if (
    name === 'skill' ||
    name === 'skill_view' ||
    name === 'skill_manage' ||
    name === 'skills_list'
  )
    return 'skill'
  // todo is its own tool, not a skill
  if (name === 'todo') return 'todo'
  // kanban task tool
  if (name === 'task' || named('kanban')) return 'kanban'
  // plugin tools: honcho_*, mem0_*
  if (
    named(
      'honcho',
      'mem0',
      'memory',
      'recall',
      'remember',
      'context',
      'profile',
      'reasoning',
    )
  )
    return 'memory'
  if (has('job_id', 'schedule', 'repeat') || named('cron', 'cronjob'))
    return 'cron'
  return 'other'
}

const SEARCH_TOOL_NAMES = new Set(['grep', 'rg', 'search_files'])

/**
 * Infer failure from a tool's JSON output when the result carries no explicit
 * isError. Only structured fields count — never substring matches on text.
 * grep/rg exit 1 means "no matches", not failure.
 */
export function detectToolError(
  output: string | undefined,
  toolName: string,
  input?: Record<string, unknown>,
): boolean {
  const text = output?.trim() ?? ''
  if (!text.startsWith('{')) return false
  // Skip parsing huge outputs that cannot carry an error field.
  if (text.length > 64 * 1024 && !/"(error|status|exit_code)"\s*:/.test(text))
    return false
  const parsed = parseJsonRecord(text)
  if (!parsed) return false
  const err = parsed.error
  if (typeof err === 'string' && err.trim()) return true
  if (isRecord(err) && Object.keys(err).length > 0) return true
  if (parsed.status === 'error') return true
  const exitCode = parsed.exit_code
  if (typeof exitCode !== 'number' || exitCode === 0) return false
  if (exitCode === 1) {
    const command = unwrapToolInput(input)?.command
    const isSearch =
      SEARCH_TOOL_NAMES.has(toolName.toLowerCase()) ||
      (typeof command === 'string' &&
        /(^|[|;&]\s*)(grep|rg)\b/.test(command.trim()))
    if (isSearch) return false
  }
  return true
}

export function isMcpToolEntry(
  entry: Pick<FlatToolEntry, 'name'>,
  mcpToolNames: ReadonlySet<string> = new Set(),
): boolean {
  const name = entry.name.toLowerCase()
  return (
    name === 'load_mcp_tools' ||
    name === 'load_mcp_server' ||
    name.startsWith('mcp__') ||
    name.startsWith('mcp_') ||
    mcpToolNames.has(name)
  )
}

/**
 * Resolve the MCP server a tool belongs to.
 * `mcp__srv__tool` → srv. `mcp_<srv>_<tool>` is ambiguous, so match the
 * longest configured server name (with '-' normalised to '_').
 */
export function mcpServerOf(
  name: string,
  serverNames: Iterable<string>,
): string {
  const lower = name.toLowerCase()
  if (lower.startsWith('mcp__')) {
    const srv = lower.split('__')[1] ?? ''
    const norm = srv.replaceAll('-', '_')
    for (const server of serverNames) {
      if (server.toLowerCase().replaceAll('-', '_') === norm)
        return server.toLowerCase()
    }
    return srv || 'other'
  }
  if (!lower.startsWith('mcp_')) return 'other'
  const rest = lower.slice('mcp_'.length)
  let bestLen = 0
  let best = 'other'
  for (const server of serverNames) {
    const norm = server.toLowerCase().replaceAll('-', '_')
    if (
      norm.length > bestLen &&
      (rest === norm || rest.startsWith(`${norm}_`))
    ) {
      bestLen = norm.length
      best = server.toLowerCase()
    }
  }
  return best
}

export function isFileToolEntry(
  entry: Pick<FlatToolEntry, 'name' | 'input'>,
): boolean {
  const name = entry.name.toLowerCase()
  if (
    /(^|_)(read|write|edit|patch|delete|remove|rename|move|create|search|list)_?file(s)?$/.test(
      name,
    ) ||
    /^file_(read|write|edit|patch|delete|remove|rename|move|create|search|list)$/.test(
      name,
    )
  )
    return true
  if (
    [
      'read',
      'write',
      'edit',
      'delete',
      'remove',
      'rename',
      'move',
      'glob',
      'apply_patch',
    ].includes(name)
  )
    return true

  const input = unwrapToolInput(entry.input)
  if (
    !input ||
    !['file_path', 'path', 'target_file', 'filepath'].some(
      (key) => key in input,
    )
  ) {
    return false
  }
  return /(^|_)(read|write|edit|patch|delete|remove|rename|move|create|search|list|file|notebook)/.test(
    name,
  )
}

/** 'all' includes file entries (surfaced via the "file" category chip). */
export function filterToolEntries(
  entries: Array<FlatToolEntry>,
  view: ToolHistoryView,
  mcpToolNames: ReadonlySet<string> = new Set(),
): Array<FlatToolEntry> {
  if (view === 'todos')
    return entries.filter((entry) => entry.name.toLowerCase() === 'todo')
  if (view === 'mcp')
    return entries.filter((entry) => isMcpToolEntry(entry, mcpToolNames))
  if (view === 'files') {
    return entries.filter(
      (entry) => !isMcpToolEntry(entry, mcpToolNames) && isFileToolEntry(entry),
    )
  }
  return entries.filter(
    (entry) =>
      entry.name.toLowerCase() !== 'todo' &&
      !isMcpToolEntry(entry, mcpToolNames),
  )
}

/**
 * Todo list from the newest todo call. Its OUTPUT is the full list; its args
 * are the full list only when `merge !== true`. Never falls back to an older
 * call (that list would be stale), so returns null instead.
 */
export function latestTodoSnapshot(
  entries: Array<FlatToolEntry>,
): TodoSnapshot | null {
  let newest: FlatToolEntry | undefined
  for (const entry of entries) {
    if (entry.name.toLowerCase() !== 'todo') continue
    if (!newest || (entry.timestamp ?? 0) >= (newest.timestamp ?? 0))
      newest = entry
  }
  if (!newest) return null
  const out = parseJsonRecord(newest.output?.trim())
  if (out && Array.isArray(out.todos)) {
    return {
      todos: readTodoItems(out),
      summary: isRecord(out.summary) ? out.summary : undefined,
    }
  }
  // Merge-mode args are a partial patch; an older list would be stale.
  const args = unwrapToolInput(newest.input)
  if (args && Array.isArray(args.todos) && args.merge !== true) {
    return { todos: readTodoItems(args) }
  }
  return null
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
  /** undefined = no explicit flag; detectToolError decides. */
  isError?: boolean
  output: string
  timestamp?: number
}

/** Determine phase → status. Unknown phases fail closed to avoid phantom spinners. */
function phaseToStatus(phase: string): 'running' | 'done' | 'error' {
  if (phase === 'error' || phase === 'failed' || phase === 'failure')
    return 'error'
  if (
    phase === 'done' ||
    phase === 'result' ||
    phase === 'complete' ||
    phase === 'completed'
  )
    return 'done'
  if (
    phase === 'start' ||
    phase === 'started' ||
    phase === 'calling' ||
    phase === 'running'
  )
    return 'running'
  return 'done'
}

function toInput(args: unknown): Record<string, unknown> | undefined {
  if (isRecord(args)) return args
  return args !== undefined ? { value: args } : undefined
}

function explicitError(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** Build FlatToolEntry list from streaming tool calls */
export function extractStreamingEntries(
  streamingToolCalls: Array<StreamingToolCall>,
): Array<FlatToolEntry> {
  return streamingToolCalls.map((tc) => {
    const status = phaseToStatus(tc.phase)
    const input = toInput(tc.args)
    // Use result field for output; empty string is valid (shows 'done' with empty body)
    const output = status !== 'running' ? (tc.result ?? '') : undefined
    return {
      key: tc.id,
      isCall: true,
      name: tc.name,
      callId: tc.id,
      input,
      output,
      isError:
        status === 'error' ||
        (status === 'done' && detectToolError(output, tc.name, input)),
      // firstSeenAt is set by chat-store on SSE insert — reliable per-tool clock.
      timestamp: tc.firstSeenAt,
      displayTs: tc.firstSeenAt,
    }
  })
}

export function extractToolEntries(
  messages: Array<ChatMessage>,
): Array<FlatToolEntry> {
  const entries: Array<FlatToolEntry> = []
  const resultsByCallId = new Map<string, RootLevelResult>()

  // First pass: collect tool results.
  // Two shapes occur in the wild:
  //   (a) realtime: a separate message with role 'tool'/'toolResult' and a
  //       top-level toolCallId field.
  //   (b) history (hermes-api.ts): role 'tool' with a content block of
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
      const output =
        textOutput || (m.details ? JSON.stringify(m.details, null, 2) : '')
      resultsByCallId.set(rootToolCallId, {
        toolCallId: rootToolCallId,
        toolName: typeof m.toolName === 'string' ? m.toolName : undefined,
        isError: explicitError(m.isError),
        output,
        timestamp: getMessageTimestamp(m),
      })
      continue
    }
    if (!Array.isArray(m.content)) continue
    for (const c of m.content) {
      const cAny = c as unknown as Record<string, unknown>
      if (cAny.type !== 'tool_result' && cAny.type !== 'toolResult') continue
      const callId = typeof cAny.toolCallId === 'string' ? cAny.toolCallId : ''
      if (!callId) continue
      const text =
        typeof cAny.text === 'string'
          ? cAny.text
          : Array.isArray(cAny.content)
            ? (cAny.content as Array<{ type?: string; text?: string }>)
                .filter((p) => p.type === 'text')
                .map((p) => p.text ?? '')
                .join('')
            : ''
      const details = cAny.details as Record<string, unknown> | undefined
      const output = text || (details ? JSON.stringify(details, null, 2) : '')
      resultsByCallId.set(callId, {
        toolCallId: callId,
        toolName: typeof cAny.toolName === 'string' ? cAny.toolName : undefined,
        isError: explicitError(cAny.isError),
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
      // result?.timestamp is the tool result message's timestamp — reliable.
      // baseTs is the parent assistant message — shared across all calls in the
      // turn, so we use it only for sort order, never for display.
      const reliableTs = result?.timestamp
      const name = c.name ?? ''
      entries.push({
        key: callId || `${name || 'tool'}-${entries.length}`,
        isCall: true,
        name,
        callId,
        input: c.arguments,
        output: result ? result.output : undefined,
        isError: result
          ? (result.isError ??
            detectToolError(result.output, name, c.arguments))
          : false,
        timestamp: reliableTs ?? baseTs + subIdx * 0.001,
        displayTs: reliableTs,
      })
      subIdx++
    }
  })

  return entries
}

/**
 * Scan all messages once and build callId → result-message timestamp.
 * Covers both root-level toolCallId messages and tool_result content blocks.
 */
export function buildResultTsMap(
  messages: Array<ChatMessage>,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const m of messages) {
    const ts = getMessageTimestamp(m)
    if (ts == null) continue
    const rootId =
      typeof m.toolCallId === 'string' && m.toolCallId ? m.toolCallId : ''
    if (rootId) {
      map.set(rootId, ts)
      continue
    }
    if (!Array.isArray(m.content)) continue
    for (const c of m.content) {
      const cAny = c as unknown as Record<string, unknown>
      if (cAny.type !== 'tool_result' && cAny.type !== 'toolResult') continue
      const id = typeof cAny.toolCallId === 'string' ? cAny.toolCallId : ''
      if (id) map.set(id, ts)
    }
  }
  return map
}

/** Extract completed tool calls embedded on a finished assistant message */
export function extractStreamToolCallsFromMessages(
  messages: Array<ChatMessage>,
  resultTsMap: Map<string, number> = new Map(),
): Array<FlatToolEntry> {
  const entries: Array<FlatToolEntry> = []
  messages.forEach((m, msgIdx) => {
    const mAny = m as unknown as Record<string, unknown>
    // Two shapes carry embedded tool-call summaries:
    //   __streamToolCalls — written by chat-store on the realtime 'done' event.
    //   streamToolCalls   — written by hermes-api.ts when normalising history
    //                       (server-side history reload). Phase is already
    //                       'complete' on this path and there is NO result —
    //                       the output lives on the separate role:'tool' message.
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
      const input = toInput(tc.args)
      const output = status !== 'running' ? (tc.result ?? '') : undefined
      // Reliable per-tool timestamp: firstSeenAt (SSE-stamped) or result-msg ts.
      // baseTs (parent message) is shared across all calls in the turn — use
      // only for sort order, never as a display timestamp.
      const reliableTs = tc.firstSeenAt ?? resultTsMap.get(tc.id)
      entries.push({
        key: tc.id || `${tc.name}-${entries.length}`,
        isCall: true,
        name: tc.name,
        callId: tc.id,
        input,
        output,
        isError:
          status === 'error' ||
          (status === 'done' && detectToolError(output, tc.name, input)),
        timestamp: reliableTs ?? baseTs + subIdx * 0.001,
        displayTs: reliableTs,
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
 * An incoming entry with an empty output never erases an existing non-empty
 * output (history streamToolCalls carry phase 'complete' but no result).
 */
export function mergeToolEntries(
  streamingEntries: Array<FlatToolEntry>,
  completedEntries: Array<FlatToolEntry>,
  messageEntries: Array<FlatToolEntry>,
): Array<FlatToolEntry> {
  const byCallId = new Map<string, FlatToolEntry>()

  const isSettled = (e: FlatToolEntry) =>
    e.isError === true || e.output !== undefined

  for (const e of messageEntries) {
    byCallId.set(e.callId || e.key, e)
  }

  const combine = (
    existing: FlatToolEntry | undefined,
    e: FlatToolEntry,
  ): FlatToolEntry => ({
    ...e,
    // Sort timestamp: prefer a defined value; fall back to the other.
    timestamp: existing?.timestamp ?? e.timestamp,
    // Display timestamp: prefer whichever source has a reliable per-tool ts.
    displayTs: existing?.displayTs ?? e.displayTs,
    ...(existing?.output && !e.output ? { output: existing.output } : {}),
    // An explicit error from any source wins.
    isError: existing?.isError === true || e.isError === true,
  })

  for (const e of completedEntries) {
    const k = e.callId || e.key
    const existing = byCallId.get(k)
    if (!existing || !isSettled(existing) || isSettled(e)) {
      byCallId.set(k, combine(existing, e))
    }
  }

  for (const e of streamingEntries) {
    const k = e.callId || e.key
    const existing = byCallId.get(k)
    if (existing && isSettled(existing) && !isSettled(e)) continue
    byCallId.set(k, combine(existing, e))
  }

  return Array.from(byCallId.values())
}
