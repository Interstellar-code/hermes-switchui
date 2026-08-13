/**
 * Hermes Agent FastAPI Client
 *
 * HTTP client for the Hermes Agent FastAPI backend (default: http://127.0.0.1:8642).
 * Replaces legacy WebSocket connection for the Hermes Switch UI fork.
 */

import {
  HERMES_SESSION_KEY_HEADER,
  resolveSessionKeyValue,
} from '../lib/send-stream-session-headers'
import {
  BEARER_TOKEN,
  CLAUDE_API,
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  dashboardFetch,
  ensureGatewayProbed,
  getCapabilities,
  probeGateway,
} from './gateway-capabilities'
import {
  createSession as createDashboardSession,
  deleteSession as deleteDashboardSession,
  forkSession as forkDashboardSession,
  getSession as getDashboardSession,
  getSessionMessages as getDashboardSessionMessages,
  listSessions as listDashboardSessions,
  searchSessions as searchDashboardSessions,
  updateSession as updateDashboardSession,
} from './claude-dashboard-api'
import { assertProfileResponseOk, scopedPath } from './profile-scope'

const _authHeaders = (): Record<string, string> =>
  BEARER_TOKEN ? { Authorization: `Bearer ${BEARER_TOKEN}` } : {}

// Log API URL once per process; HMR reloads this module repeatedly so a bare
// top-level console.log spams the dev server logs in a tight loop.
const _CLAUDE_API_LOG_KEY = Symbol.for('hermes.hermes-api.configured-log')
if (!(globalThis as Record<symbol, unknown>)[_CLAUDE_API_LOG_KEY]) {
  ;(globalThis as Record<symbol, unknown>)[_CLAUDE_API_LOG_KEY] = true
  console.log(`[hermes-api] Configured API: ${CLAUDE_API}`)
}

// ── Types ─────────────────────────────────────────────────────────

export type ClaudeSession = {
  id: string
  source?: string
  user_id?: string | null
  model?: string | null
  title?: string | null
  started_at?: number
  ended_at?: number | null
  end_reason?: string | null
  message_count?: number
  tool_call_count?: number
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  reasoning_tokens?: number
  actual_cost_usd?: number | null
  estimated_cost_usd?: number | null
  api_call_count?: number
  has_model_config?: boolean
  has_system_prompt?: boolean
  parent_session_id?: string | null
  last_active?: number | null
  preview?: string | null
  is_active?: boolean
  /** Present only on rows from listProfileSessions (dashboard multiplex aggregation). */
  profile?: string
  profile_name?: string
  is_default_profile?: boolean
}

export type ClaudeMessage = {
  id: number
  session_id: string
  role: string
  content: string | null
  tool_call_id?: string | null
  tool_calls?: Array<unknown> | string | null
  tool_name?: string | null
  timestamp: number
  token_count?: number | null
  finish_reason?: string | null
}

export type ClaudeConfig = {
  model?: string
  provider?: string
  [key: string]: unknown
}

export type SessionMessagesQuery = {
  limit?: number
  offset?: number
}

// ── Helpers ───────────────────────────────────────────────────────

// Hard cap on how long any non-streaming gateway/dashboard request may hang.
// Without this, a stalled/unreachable gateway turns into an indefinitely
// pending fetch — which collapsed into an empty chat downstream (#217).
const GATEWAY_REQUEST_TIMEOUT_MS = 10_000

// Captured upstream error bodies are bounded so a huge HTML/error page can't
// balloon the thrown message (#217).
const ERROR_BODY_CAP = 500

/** Translate a fetch abort/timeout into a recognizable thrown error so routes
 *  can map it to 503/504. AbortSignal.timeout() rejects with a TimeoutError;
 *  a caller-cancelled signal rejects with AbortError. */
function _asGatewayError(err: unknown, path: string): Error {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return new Error(`Hermes Agent API ${path}: gateway timeout`)
  }
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new Error(`Hermes Agent API ${path}: gateway timeout`)
  }
  return err instanceof Error ? err : new Error(String(err))
}

// Every gateway call routes its path through scopedPath(). `profile` is the
// explicit selection: null/undefined leaves the path untouched and probes
// nothing; when set, scopedPath() fails closed before the fetch is issued.

async function claudeGet<T>(path: string, profile?: string | null): Promise<T> {
  const wirePath = await scopedPath(path, profile)
  let res: Response
  try {
    res = await fetch(`${CLAUDE_API}${wirePath}`, {
      headers: _authHeaders(),
      signal: AbortSignal.timeout(GATEWAY_REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw _asGatewayError(err, path)
  }
  await assertProfileResponseOk(res, profile)
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, ERROR_BODY_CAP)
    throw new Error(`Hermes Agent API ${path}: ${res.status} ${body}`)
  }
  return res.json() as Promise<T>
}

async function claudePost<T>(
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
  profile?: string | null,
): Promise<T> {
  const wirePath = await scopedPath(path, profile)
  let res: Response
  try {
    res = await fetch(`${CLAUDE_API}${wirePath}`, {
      method: 'POST',
      headers: {
        ..._authHeaders(),
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(GATEWAY_REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw _asGatewayError(err, `POST ${path}`)
  }
  await assertProfileResponseOk(res, profile)
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, ERROR_BODY_CAP)
    throw new Error(`Hermes Agent API POST ${path}: ${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

async function claudePatch<T>(
  path: string,
  body: unknown,
  profile?: string | null,
): Promise<T> {
  const wirePath = await scopedPath(path, profile)
  let res: Response
  try {
    res = await fetch(`${CLAUDE_API}${wirePath}`, {
      method: 'PATCH',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GATEWAY_REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw _asGatewayError(err, `PATCH ${path}`)
  }
  await assertProfileResponseOk(res, profile)
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, ERROR_BODY_CAP)
    throw new Error(`Hermes Agent API PATCH ${path}: ${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

async function claudeDeleteReq(
  path: string,
  profile?: string | null,
): Promise<void> {
  const wirePath = await scopedPath(path, profile)
  let res: Response
  try {
    res = await fetch(`${CLAUDE_API}${wirePath}`, {
      method: 'DELETE',
      headers: _authHeaders(),
      signal: AbortSignal.timeout(GATEWAY_REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw _asGatewayError(err, `DELETE ${path}`)
  }
  await assertProfileResponseOk(res, profile)
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, ERROR_BODY_CAP)
    throw new Error(`Hermes Agent API DELETE ${path}: ${res.status} ${text}`)
  }
}

// ── Dashboard helpers (targets port 9119, not gateway) ────────────
//
// Uses same-origin `/api/dashboard-proxy` when running in the browser to avoid
// CORS. The proxy route injects the dashboard bearer token server-side.
// On SSR (Node), falls back to direct dashboardFetch so the server-to-server
// call goes straight to port 9119 without an HTTP round-trip through itself.

function _dashboardProxyFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (typeof window !== 'undefined') {
    // Browser: call same-origin proxy, no CORS issue
    const proxyPath = `/api/dashboard-proxy${path.startsWith('/') ? path : `/${path}`}`
    return fetch(proxyPath, init)
  }
  // SSR / server-side: call dashboard directly with auth
  return dashboardFetch(path, init)
}

async function dashboardGet<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await _dashboardProxyFetch(path, {
      signal: AbortSignal.timeout(GATEWAY_REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw _asGatewayError(err, `dashboard ${path}`)
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, ERROR_BODY_CAP)
    throw new Error(`Hermes Dashboard API ${path}: ${res.status} ${body}`)
  }
  return res.json() as Promise<T>
}

async function dashboardSend<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response
  try {
    res = await _dashboardProxyFetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(GATEWAY_REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw _asGatewayError(err, `dashboard ${method} ${path}`)
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, ERROR_BODY_CAP)
    throw new Error(
      `Hermes Dashboard API ${method} ${path}: ${res.status} ${text}`,
    )
  }
  return res.json() as Promise<T>
}

async function dashboardDelete(path: string): Promise<void> {
  let res: Response
  try {
    res = await _dashboardProxyFetch(path, {
      method: 'DELETE',
      signal: AbortSignal.timeout(GATEWAY_REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw _asGatewayError(err, `dashboard DELETE ${path}`)
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, ERROR_BODY_CAP)
    throw new Error(
      `Hermes Dashboard API DELETE ${path}: ${res.status} ${text}`,
    )
  }
}

// ── Health ────────────────────────────────────────────────────────

export async function checkHealth(): Promise<{ status: string }> {
  return claudeGet('/health')
}

// ── Sessions ─────────────────────────────────────────────────────

export async function listSessions(
  limit = 50,
  offset = 0,
): Promise<Array<ClaudeSession>> {
  if (getCapabilities().dashboard.available) {
    const resp = await listDashboardSessions(limit, offset)
    return resp.sessions as Array<ClaudeSession>
  }
  const resp = await claudeGet<{ items: Array<ClaudeSession>; total: number }>(
    `/api/sessions?limit=${limit}&offset=${offset}`,
  )
  return resp.items
}

// The dashboard branches below are UNSCOPED — they hit :9119, which resolves
// against the active profile home. When an explicit profile is selected we
// must take the gateway path so the `/p/<profile>/` prefix (and its
// fail-closed check) applies. Cross-profile dashboard *reads* get the
// `?profile=` treatment in P2; they are not a substitute here.

export async function getSession(
  sessionId: string,
  profile?: string | null,
): Promise<ClaudeSession> {
  if (!profile && getCapabilities().dashboard.available) {
    return getDashboardSession(sessionId) as Promise<ClaudeSession>
  }
  const resp = await claudeGet<{ session: ClaudeSession }>(
    `/api/sessions/${sessionId}`,
    profile,
  )
  return resp.session
}

export async function createSession(
  opts?: {
    id?: string
    title?: string
    model?: string
  },
  profile?: string | null,
): Promise<ClaudeSession> {
  if (
    !profile &&
    getCapabilities().dashboard.available &&
    !getCapabilities().enhancedChat
  ) {
    const resp = await createDashboardSession(opts || {})
    return resp.session as ClaudeSession
  }
  const resp = await claudePost<{ session: ClaudeSession }>(
    '/api/sessions',
    opts || {},
    {},
    profile,
  )
  return resp.session
}

export async function updateSession(
  sessionId: string,
  updates: { title?: string },
  profile?: string | null,
): Promise<ClaudeSession> {
  // The dashboard shortcut has no `?profile=` scoping — for an explicit
  // profile it would silently rename in whatever profile the dashboard
  // considers active, dropping the scope (same guard as createSession()).
  if (
    !profile &&
    getCapabilities().dashboard.available &&
    !getCapabilities().enhancedChat
  ) {
    const resp = await updateDashboardSession(sessionId, updates)
    return resp.session as ClaudeSession
  }
  const resp = await claudePatch<{ session: ClaudeSession }>(
    `/api/sessions/${sessionId}`,
    updates,
    profile,
  )
  return resp.session
}

export async function deleteSession(
  sessionId: string,
  profile?: string | null,
): Promise<void> {
  // Same reasoning as updateSession(): the dashboard delete has no profile
  // scoping, so a scoped delete must go through the gateway chokepoint
  // (claudeDeleteReq -> scopedPath), never the dashboard shortcut.
  if (!profile && getCapabilities().dashboard.available) {
    try {
      await deleteDashboardSession(sessionId)
      return
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Dashboard doesn't own this session — fall through to gateway DELETE
      if (!msg.includes(': 404')) throw err
    }
  }
  return claudeDeleteReq(`/api/sessions/${sessionId}`, profile)
}

export async function getMessages(
  sessionId: string,
  query: SessionMessagesQuery = {},
  profile?: string | null,
): Promise<Array<ClaudeMessage>> {
  if (!profile && getCapabilities().dashboard.available) {
    const resp = await getDashboardSessionMessages(sessionId, query)
    return resp.messages as Array<ClaudeMessage>
  }
  const params = new URLSearchParams()
  if (typeof query.limit === 'number' && Number.isFinite(query.limit)) {
    params.set('limit', String(query.limit))
  }
  if (typeof query.offset === 'number' && Number.isFinite(query.offset)) {
    params.set('offset', String(query.offset))
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  const resp = await claudeGet<{
    items?: Array<ClaudeMessage>
    data?: Array<ClaudeMessage>
    total?: number
  }>(`/api/sessions/${sessionId}/messages${suffix}`, profile)
  return resp.items ?? resp.data ?? []
}

export async function searchSessions(
  query: string,
  limit = 20,
  profile?: string | null,
): Promise<{ query?: string; count?: number; results: Array<unknown> }> {
  // The dashboard search endpoint has no profile scoping — taking it for an
  // explicit profile searches whatever the dashboard considers active and
  // returns another profile's session IDs, which the caller then resolves and
  // acts on (same guard as updateSession/deleteSession).
  if (!profile && getCapabilities().dashboard.available) {
    return searchDashboardSessions(query)
  }
  return claudeGet(
    `/api/sessions/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    profile,
  )
}

/**
 * Branch a session: the gateway ends the source with `end_reason: "branched"`,
 * creates a child carrying `parent_session_id` plus a copy of the transcript,
 * and auto-titles it from the lineage ("Foo" -> "Foo #2").
 *
 * The gateway returns `{ object: "hermes.session", session: {...} }` and does
 * NOT return a `forked_from` field — the link lives on `session.parent_session_id`.
 * `forked_from` stays optional here only because the dashboard shortcut below
 * historically claimed it.
 */
export async function forkSession(
  sessionId: string,
  profile?: string | null,
): Promise<{ session: ClaudeSession; forked_from?: string }> {
  // A fork is a write. Unscoped, it resolves the raw session ID against
  // whichever state.db the gateway is running on, so an explicitly scoped
  // fork MUST go through the gateway chokepoint (claudePost -> scopedPath),
  // never the unscoped dashboard shortcut.
  if (!profile && getCapabilities().dashboard.available) {
    try {
      return (await forkDashboardSession(sessionId)) as {
        session: ClaudeSession
        forked_from?: string
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // The dashboard (:9119) has no POST /api/sessions/{id}/fork route at all
      // — its session family stops at GET/PATCH/DELETE + /messages, /export,
      // /latest-descendant. Verified against hermes_cli/web_server.py. Fall
      // through to the gateway rather than failing the branch, same shape as
      // deleteSession() above.
      if (!msg.includes(': 404') && !msg.includes(': 405')) throw err
    }
  }
  // `{}` is required, not cosmetic: the gateway's _handle_fork_session calls
  // _read_json_body() unconditionally, which returns 400 "Invalid JSON in
  // request body" for a bodyless POST. claudePost() only serialises a truthy
  // body, so passing `undefined` here made every real fork fail.
  return claudePost(`/api/sessions/${sessionId}/fork`, {}, undefined, profile)
}

// ── Conversion helpers (Claude → Chat format) ─────────────────

/** Convert a ClaudeMessage to the ChatMessage format the frontend expects */
export function toChatMessage(
  msg: ClaudeMessage,
  options?: { historyIndex?: number },
): Record<string, unknown> {
  // Accept either parsed arrays from FastAPI or legacy JSON strings.
  let toolCalls: Array<unknown> | undefined
  if (Array.isArray(msg.tool_calls)) {
    toolCalls = msg.tool_calls
  } else if (msg.tool_calls && typeof msg.tool_calls === 'string') {
    try {
      toolCalls = JSON.parse(msg.tool_calls)
    } catch {
      toolCalls = undefined
    }
  }

  // Build content array
  const content: Array<Record<string, unknown>> = []

  // Build streamToolCalls array for separate pill rendering and content blocks
  const streamToolCallsArr: Array<Record<string, unknown>> = []
  if (msg.role === 'assistant' && toolCalls && Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      const record = tc as Record<string, unknown>
      const fn = record.function as Record<string, unknown> | undefined
      const toolCallId =
        record.id || `tc-${Math.random().toString(36).slice(2, 8)}`
      const toolName = fn?.name || record.name || 'tool'
      const toolArgs = fn?.arguments
      streamToolCallsArr.push({
        id: toolCallId,
        name: toolName,
        args: toolArgs,
        phase: 'complete',
      })
      let parsedArgs: Record<string, unknown> | undefined
      if (
        toolArgs &&
        typeof toolArgs === 'object' &&
        !Array.isArray(toolArgs)
      ) {
        parsedArgs = toolArgs as Record<string, unknown>
      } else if (typeof toolArgs === 'string' && toolArgs.trim()) {
        try {
          const parsed = JSON.parse(toolArgs)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            parsedArgs = parsed as Record<string, unknown>
          }
        } catch {
          /* leave undefined; raw string still surfaces via partialJson */
        }
      }
      content.push({
        type: 'toolCall',
        id: toolCallId,
        name: toolName,
        arguments: parsedArgs,
        partialJson: typeof toolArgs === 'string' ? toolArgs : undefined,
      })
    }
  }

  if (msg.role === 'tool') {
    content.push({
      type: 'tool_result',
      toolCallId: msg.tool_call_id,
      toolName: msg.tool_name,
      text: msg.content || '',
    })
  }

  if (msg.content && msg.role !== 'tool') {
    content.push({ type: 'text', text: msg.content })
  }

  return {
    id: `msg-${msg.id}`,
    role: msg.role,
    content,
    text: msg.content || '',
    timestamp: msg.timestamp ? msg.timestamp * 1000 : Date.now(),
    createdAt: msg.timestamp
      ? new Date(msg.timestamp * 1000).toISOString()
      : undefined,
    sessionKey: msg.session_id,
    ...(typeof options?.historyIndex === 'number'
      ? { __historyIndex: options.historyIndex }
      : {}),
    ...(streamToolCallsArr.length > 0
      ? { streamToolCalls: streamToolCallsArr }
      : {}),
  }
}

/** Convert a ClaudeSession to the session summary format the frontend expects */
export function toSessionSummary(
  session: ClaudeSession,
): Record<string, unknown> {
  return {
    key: session.id,
    friendlyId: session.id,
    kind: 'chat',
    status: session.ended_at ? 'ended' : 'idle',
    is_active:
      session.is_active ??
      (!!session.last_active &&
        !session.ended_at &&
        Date.now() - session.last_active * 1000 < 300_000),
    parentSessionId: session.parent_session_id ?? null,
    model: session.model || '',
    label: session.title || undefined,
    title: session.title || undefined,
    derivedTitle: session.title || session.preview || undefined,
    preview: session.preview || undefined,
    tokenCount: (session.input_tokens ?? 0) + (session.output_tokens ?? 0),
    totalTokens: (session.input_tokens ?? 0) + (session.output_tokens ?? 0),
    message_count: session.message_count ?? 0,
    tool_call_count: session.tool_call_count ?? 0,
    messageCount: session.message_count ?? 0,
    toolCallCount: session.tool_call_count ?? 0,
    cost: session.actual_cost_usd ?? session.estimated_cost_usd ?? 0,
    estimatedCost: session.estimated_cost_usd ?? 0,
    cacheReadTokens: session.cache_read_tokens ?? 0,
    cacheWriteTokens: session.cache_write_tokens ?? 0,
    reasoningTokens: session.reasoning_tokens ?? 0,
    apiCallCount: session.api_call_count ?? 0,
    source: session.source ?? '',
    profile: session.profile ?? session.profile_name ?? undefined,
    endReason: session.end_reason ?? '',
    createdAt: session.started_at ? session.started_at * 1000 : Date.now(),
    startedAt: session.started_at ? session.started_at * 1000 : Date.now(),
    updatedAt: session.last_active
      ? session.last_active * 1000
      : session.ended_at
        ? session.ended_at * 1000
        : session.started_at
          ? session.started_at * 1000
          : Date.now(),
    usage: {
      promptTokens: session.input_tokens ?? 0,
      completionTokens: session.output_tokens ?? 0,
      totalTokens: (session.input_tokens ?? 0) + (session.output_tokens ?? 0),
    },
  }
}

// ── Chat (streaming) ─────────────────────────────────────────────

type StreamChatOptions = {
  signal?: AbortSignal
  stableSessionKey?: string
  /** Explicitly selected profile; null/absent = unscoped (active profile). */
  profile?: string | null
  onEvent: (payload: {
    event: string
    data: Record<string, unknown>
  }) => void | Promise<void>
}

/**
 * Send a chat message and stream SSE events from Hermes Agent FastAPI.
 * Returns a promise that resolves when the stream ends.
 */
export async function streamChat(
  sessionId: string,
  body: {
    message:
      | string
      | Array<
          | { type: 'text'; text: string }
          | { type: 'image_url'; image_url: { url: string } }
        >
    model?: string
    /**
     * Per-request reasoning level for this turn (hermes-agent 0.19.15+).
     * Unlike `model`, the gateway does NOT persist it on the session, so
     * callers must send it every turn or the turn falls back to the
     * configured `agent.reasoning_effort`. Validated gateway-side before the
     * SSE stream opens: an unusable value is a JSON 400 that surfaces here as
     * a thrown `Hermes chat stream: 400 …`. See `@/lib/reasoning-effort`.
     */
    reasoning_effort?: string
    system_message?: string
    attachments?: Array<Record<string, unknown>>
  },
  opts: StreamChatOptions,
): Promise<void> {
  const headers: Record<string, string> = {
    ..._authHeaders(),
    'Content-Type': 'application/json',
    [HERMES_SESSION_KEY_HEADER]: resolveSessionKeyValue({
      stableSessionKey: opts.stableSessionKey,
      sessionId,
    }),
  }
  // Bypasses the claudeGet/claudePost chokepoints (streaming), so it scopes
  // its own path — same fail-closed contract, applied before the fetch.
  const wirePath = await scopedPath(
    `/api/sessions/${sessionId}/chat/stream`,
    opts.profile,
  )
  const res = await fetch(`${CLAUDE_API}${wirePath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  await assertProfileResponseOk(res, opts.profile)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Hermes chat stream: ${res.status} ${text}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''

  // Debug tap: when HERMES_TOOL_DEBUG=1, dump every raw SSE event to a file so
  // we can inspect what vanilla Hermes Agent actually emits during tool calls
  // (event names + data shapes) without changing any agent code.
  const toolDebug = process.env.HERMES_TOOL_DEBUG === '1'
  let toolDebugStream: NodeJS.WritableStream | null = null
  if (toolDebug) {
    try {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const os = await import('node:os')
      const dir = path.join(os.tmpdir(), 'hermes-tool-debug')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `sse-${sessionId}-${Date.now()}.log`)
      toolDebugStream = fs.createWriteStream(file, { flags: 'a' })
      console.log(`[hermes-api][tool-debug] writing SSE dump to ${file}`)
      toolDebugStream.write(
        `# session=${sessionId} ts=${new Date().toISOString()}\n`,
      )
    } catch (err) {
      console.warn('[hermes-api][tool-debug] failed to open dump file:', err)
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
          if (toolDebugStream) toolDebugStream.write(`event: ${currentEvent}\n`)
        } else if (line.startsWith('data: ')) {
          const dataStr = line.slice(6)
          if (dataStr === '[DONE]') {
            if (toolDebugStream) toolDebugStream.write('data: [DONE]\n\n')
            continue
          }
          if (toolDebugStream) {
            // Truncate very long payloads so the dump stays human-readable.
            const trimmed =
              dataStr.length > 4000
                ? dataStr.slice(0, 4000) + '...[trunc]'
                : dataStr
            toolDebugStream.write(`data: ${trimmed}\n\n`)
          }
          try {
            const data = JSON.parse(dataStr) as Record<string, unknown>
            await opts.onEvent({ event: currentEvent || 'message', data })
          } catch {
            // skip malformed JSON
          }
        }
      }
    }
  } finally {
    // Always release the reader lock so the underlying connection can be
    // returned to the pool, even if opts.onEvent() throws or the caller
    // cancels mid-stream (#72).
    await reader.cancel().catch(() => {})
  }

  if (toolDebugStream) {
    try {
      toolDebugStream.end()
    } catch {
      // ignore close errors
    }
  }
}

/** Non-streaming chat */
export async function sendChat(
  sessionId: string,
  messageOrOpts: string | { message: string; model?: string },
  model?: string,
  options: { stableSessionKey?: string; profile?: string | null } = {},
): Promise<Record<string, unknown>> {
  const msg =
    typeof messageOrOpts === 'string' ? messageOrOpts : messageOrOpts.message
  const mdl = typeof messageOrOpts === 'string' ? model : messageOrOpts.model
  return claudePost(
    `/api/sessions/${sessionId}/chat`,
    { message: msg, model: mdl },
    {
      [HERMES_SESSION_KEY_HEADER]: resolveSessionKeyValue({
        stableSessionKey: options.stableSessionKey,
        sessionId,
      }),
    },
    options.profile,
  )
}

// ── Memory ───────────────────────────────────────────────────────

export async function getMemory(): Promise<unknown> {
  return dashboardGet('/api/memory')
}

// ── Skills ───────────────────────────────────────────────────────

export async function listSkills(): Promise<unknown> {
  return dashboardGet('/api/skills')
}

export async function getSkill(name: string): Promise<unknown> {
  return dashboardGet(`/api/skills/${encodeURIComponent(name)}`)
}

export async function getSkillCategories(): Promise<unknown> {
  return dashboardGet('/api/skills/categories')
}

export async function toggleSkill(
  name: string,
  enabled: boolean,
): Promise<unknown> {
  return dashboardSend('POST', '/api/skills/toggle', { name, enabled })
}

export async function listToolsets(): Promise<unknown> {
  return dashboardGet('/api/tools/toolsets')
}

// ── Dashboard plugins ─────────────────────────────────────────────

export async function listDashboardPlugins(): Promise<unknown> {
  return dashboardGet('/api/dashboard/plugins')
}

export async function installAgentPlugin(body: {
  identifier: string
  force?: boolean
  enable?: boolean
}): Promise<unknown> {
  return dashboardSend('POST', '/api/dashboard/agent-plugins/install', body)
}

export async function enableAgentPlugin(name: string): Promise<unknown> {
  return dashboardSend(
    'POST',
    `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/enable`,
  )
}

export async function disableAgentPlugin(name: string): Promise<unknown> {
  return dashboardSend(
    'POST',
    `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/disable`,
  )
}

export async function updateAgentPlugin(name: string): Promise<unknown> {
  return dashboardSend(
    'POST',
    `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/update`,
  )
}

export async function deleteAgentPlugin(name: string): Promise<void> {
  return dashboardDelete(
    `/api/dashboard/agent-plugins/${encodeURIComponent(name)}`,
  )
}

export async function setPluginVisibility(
  name: string,
  hidden: boolean,
): Promise<unknown> {
  return dashboardSend(
    'POST',
    `/api/dashboard/plugins/${encodeURIComponent(name)}/visibility`,
    { hidden },
  )
}

// ── Config ───────────────────────────────────────────────────────

export async function getConfig(): Promise<ClaudeConfig> {
  return dashboardGet<ClaudeConfig>('/api/config')
}

// Issue #214: config rarely changes but is read on every session-status poll.
// Cache the resolved config for a short TTL to collapse the per-poll gateway
// round-trip. The cache is invalidated by the dashboard proxy on config writes.
let configCache: { value: ClaudeConfig; expiresAt: number } | null = null

export async function getConfigCached(ttlMs = 30_000): Promise<ClaudeConfig> {
  const now = Date.now()
  if (configCache && configCache.expiresAt > now) {
    return configCache.value
  }
  const value = await getConfig()
  configCache = { value, expiresAt: now + ttlMs }
  return value
}

/**
 * Called by `routes/api/dashboard-proxy/$.ts` after any successful write to
 * `/api/config*`, since config writes go through that proxy and never through
 * this module.
 */
export function invalidateConfigCache(): void {
  configCache = null
}

// ── Model / Provider APIs ────────────────────────────────────────

export type ModelInfo = {
  model: string
  provider: string
  [key: string]: unknown
}

export type ModelOptions = {
  providers: Array<{
    slug: string
    name?: string
    is_current?: boolean
    models: Array<string>
    total_models?: number
    [key: string]: unknown
  }>
  model: string
  provider: string
  [key: string]: unknown
}

export type ModelAuxiliary = {
  tasks: Array<{
    task: string
    provider: string
    model: string
    base_url?: string
  }>
  main: { provider: string; model: string }
  [key: string]: unknown
}

export type ConfigSchema = {
  fields: Record<string, unknown>
  category_order: Array<string>
  [key: string]: unknown
}

export async function getConfigSchema(): Promise<ConfigSchema> {
  return dashboardGet<ConfigSchema>('/api/config/schema')
}

export async function modelInfo(): Promise<ModelInfo> {
  return dashboardGet<ModelInfo>('/api/model/info')
}

export async function modelOptions(): Promise<ModelOptions> {
  return dashboardGet<ModelOptions>('/api/model/options')
}

export async function modelAuxiliary(): Promise<ModelAuxiliary> {
  return dashboardGet<ModelAuxiliary>('/api/model/auxiliary')
}

export async function setModelAssignment(body: {
  scope: 'main' | string
  provider: string
  model: string
  task?: string
}): Promise<Record<string, unknown>> {
  return dashboardSend<Record<string, unknown>>('POST', '/api/model/set', body)
}

// ── Toolsets ─────────────────────────────────────────────────────

export type GatewayToolset = {
  name: string
  label: string
  description?: string
  enabled?: boolean
  configured?: boolean
  tools?: Array<string>
}

/** GET /v1/toolsets — live toolset registry from the gateway (includes
 *  plugin-registered toolsets, which the gateway labels with a 🔌 prefix).
 *  Same auth as /v1/models. Throws on non-2xx / unreachable gateway.
 *  Distinct from listToolsets() above, which targets the dashboard. */
export async function listGatewayToolsets(): Promise<{
  object: string
  platform?: string
  data: Array<GatewayToolset>
}> {
  return claudeGet('/v1/toolsets')
}

// ── Connection check ─────────────────────────────────────────────

export async function isClaudeAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${CLAUDE_API}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) {
      await probeGateway({ force: true })
      return false
    }
    await probeGateway({ force: true })
    return true
  } catch {
    await probeGateway({ force: true }).catch(() => undefined)
    return false
  }
}

// ── Env vars ─────────────────────────────────────────────────────

export type EnvVarInfo = {
  is_set: boolean
  redacted_value: string
  description?: string
  category?: string
  is_password?: boolean
  advanced?: boolean
  url?: string
}

export async function getEnv(): Promise<Record<string, EnvVarInfo>> {
  return dashboardGet('/api/env')
}

export async function putEnv(key: string, value: string): Promise<void> {
  const res = await _dashboardProxyFetch('/api/env', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Hermes Dashboard API PUT /api/env: ${res.status} ${text}`)
  }
}

export async function deleteEnv(key: string): Promise<void> {
  const res = await _dashboardProxyFetch('/api/env', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Hermes Dashboard API DELETE /api/env: ${res.status} ${text}`,
    )
  }
}

export async function revealEnv(
  key: string,
): Promise<{ key: string; value: string }> {
  const res = await _dashboardProxyFetch('/api/env/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
  if (res.status === 429) {
    throw new Error('Rate limited. Please wait before revealing again.')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Hermes Dashboard API POST /api/env/reveal: ${res.status} ${text}`,
    )
  }
  return res.json() as Promise<{ key: string; value: string }>
}

// ── OAuth providers ───────────────────────────────────────────────

export type OAuthProvider = {
  id: string
  name: string
  logged_in: boolean
  token_preview?: string
  expires_at?: string
  status?: string
}

export async function listOAuthProviders(): Promise<Array<OAuthProvider>> {
  const res = await dashboardGet<
    { providers?: Array<OAuthProvider> } | Array<OAuthProvider>
  >('/api/providers/oauth')
  if (Array.isArray(res)) return res
  return res.providers ?? []
}

export async function deleteOAuth(providerId: string): Promise<void> {
  return dashboardDelete(`/api/providers/oauth/${providerId}`)
}

// ── Analytics ─────────────────────────────────────────────────────

export type AnalyticsUsage = {
  total_tokens?: number
  total_calls?: number
  total_input?: number
  total_output?: number
  total_sessions?: number
  total_api_calls?: number
  total_estimated_cost?: number
  [key: string]: unknown
}

export async function analyticsUsage(days = 30): Promise<AnalyticsUsage> {
  return dashboardGet(`/api/analytics/usage?days=${days}`)
}

export type AnalyticsModelRow = {
  model: string
  input_tokens?: number
  output_tokens?: number
  sessions?: number
  api_calls?: number
  estimated_cost?: number
  [key: string]: unknown
}

export type AnalyticsModels = {
  models: Array<AnalyticsModelRow>
  [key: string]: unknown
}

export async function analyticsModels(days = 30): Promise<AnalyticsModels> {
  return dashboardGet(`/api/analytics/models?days=${days}`)
}

// ── Gateway status ────────────────────────────────────────────────

export type GatewayStatus = {
  gateway_running?: boolean
  pid?: number
  cpu?: number
  rss?: number
  [key: string]: unknown
}

export async function gatewayStatus(): Promise<GatewayStatus> {
  return dashboardGet('/api/status')
}

export async function gatewayRestart(): Promise<unknown> {
  return dashboardSend('POST', '/api/gateway/restart')
}

export async function getLogs(): Promise<unknown> {
  return dashboardGet('/api/logs')
}

export {
  ensureGatewayProbed,
  getCapabilities as getGatewayCapabilities,
  CLAUDE_API,
  SESSIONS_API_UNAVAILABLE_MESSAGE,
}
