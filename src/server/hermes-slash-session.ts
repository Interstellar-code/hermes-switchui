/**
 * tui_gateway session binding for `slash.exec`.
 *
 * ── The problem ───────────────────────────────────────────────────────────
 * `commands.catalog` needs no session. `slash.exec` does: it opens with
 * `_sess_nowait(params, rid)` (`tui_gateway/server.py:14682`), which is a bare
 * `_sessions.get(params["session_id"])` with **no active-session fallback**
 * (`server.py:1727-1729`). An absent or unknown id is error `4001 session not
 * found`. Verified live: passing SwitchUI's own chat session id directly →
 * 4001, because that id names an `api_server` row, not an in-memory
 * tui_gateway session.
 *
 * ── The binding, and why it is per-chat rather than shared ────────────────
 * §9 of the plan leaned "one shared session for the read-only commands". Run
 * against the live agent, that turns out to be the wrong call — a freshly
 * created tui_gateway session is *empty*, so the shared session answers:
 *
 *     /status  → "Session ID: 20260812_085913_… Tokens: 0 Agent Running: No"
 *     /history → "No conversation history yet."
 *
 * i.e. it reports a session the user has never seen. Both allowlisted live
 * commands are precisely the ones that read session state, so a shared session
 * makes the entire read-only surface wrong. `session.resume(<chat session id>)`
 * fixes it — verified live, the same two commands then print the caller's real
 * session id and real transcript. So: **resume the caller's chat session; fall
 * back to a shared scratch session only when there is no chat session yet**
 * (a brand-new chat, where there is nothing to report anyway).
 *
 * ── The cost, and the reaping ─────────────────────────────────────────────
 * `session.create`/`session.resume` schedule an agent build 50ms later
 * (`server.py:5881` → `_schedule_agent_build` → `_start_agent_build`), and that
 * build spawns a `_SlashWorker` — a real `subprocess.Popen` of
 * `python -m tui_gateway.slash_worker` (`server.py:1642`, `slash_worker.py`).
 * One per bound session. So bindings are cached, LRU-capped, and idle-reaped
 * with `session.close`, which is verified non-destructive: resuming a real
 * SwitchUI session and closing it again leaves its id, transcript and message
 * count untouched in `session.list`.
 */

import { HermesRpcError, hermesRpc } from './hermes-rpc'

/** Close a binding after this long without use. */
const IDLE_TTL_MS = 5 * 60_000
/** How often the reaper looks. */
const SWEEP_INTERVAL_MS = 60_000
/** Hard cap on concurrent bindings — each one is a Python subprocess. */
const MAX_BINDINGS = 4
/** Session lifecycle RPCs are fast (<100ms live); this is pure headroom. */
const LIFECYCLE_TIMEOUT_MS = 10_000

/** Cache key for the scratch session used when the caller has no chat yet. */
const SHARED_KEY = '__switchui_shared__'

type Binding = {
  /** The short tui_gateway handle, e.g. `b42c55cc`. */
  handle: string
  lastUsedAt: number
}

type SessionRpcResult = {
  session_id?: unknown
}

const bindings = new Map<string, Binding>()
const inflight = new Map<string, Promise<string>>()
let sweeper: ReturnType<typeof setInterval> | null = null

function handleFrom(result: unknown): string {
  const value = (result ?? {}) as SessionRpcResult
  const handle = typeof value.session_id === 'string' ? value.session_id.trim() : ''
  if (!handle) {
    throw new Error('tui_gateway session response carried no session_id')
  }
  return handle
}

async function closeHandle(handle: string): Promise<void> {
  try {
    await hermesRpc('session.close', { session_id: handle }, {
      timeoutMs: LIFECYCLE_TIMEOUT_MS,
    })
  } catch {
    // A binding we cannot close is a binding the dashboard has already lost
    // (restart, eviction). Dropping it locally is the whole remedy.
  }
}

function startSweeper() {
  if (sweeper) return
  sweeper = setInterval(() => {
    const cutoff = Date.now() - IDLE_TTL_MS
    for (const [key, binding] of [...bindings]) {
      if (binding.lastUsedAt > cutoff) continue
      bindings.delete(key)
      void closeHandle(binding.handle)
    }
    if (bindings.size === 0 && sweeper) {
      clearInterval(sweeper)
      sweeper = null
    }
  }, SWEEP_INTERVAL_MS)
  sweeper.unref()
}

async function evictOldest() {
  while (bindings.size >= MAX_BINDINGS) {
    let oldestKey: string | null = null
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [key, binding] of bindings) {
      if (binding.lastUsedAt < oldestAt) {
        oldestAt = binding.lastUsedAt
        oldestKey = key
      }
    }
    if (!oldestKey) return
    const evicted = bindings.get(oldestKey)
    bindings.delete(oldestKey)
    if (evicted) await closeHandle(evicted.handle)
  }
}

async function openBinding(chatSessionId: string | null): Promise<string> {
  if (chatSessionId) {
    // `session.resume` takes the stored/api_server id and returns a fresh
    // in-memory handle bound to that transcript.
    const resumed = await hermesRpc<unknown>(
      'session.resume',
      { session_id: chatSessionId },
      { timeoutMs: LIFECYCLE_TIMEOUT_MS },
    )
    return handleFrom(resumed)
  }
  const created = await hermesRpc<unknown>(
    'session.create',
    { title: 'SwitchUI commands' },
    { timeoutMs: LIFECYCLE_TIMEOUT_MS },
  )
  return handleFrom(created)
}

/**
 * Resolve a tui_gateway session handle for a SwitchUI chat session.
 *
 * @param chatSessionId The caller's own chat session id, or null/undefined for
 *   a chat that has not been created yet — which binds the shared scratch
 *   session instead.
 */
export async function acquireSlashSession(
  chatSessionId?: string | null,
): Promise<string> {
  const trimmed = typeof chatSessionId === 'string' ? chatSessionId.trim() : ''
  const key = trimmed || SHARED_KEY

  const existing = bindings.get(key)
  if (existing) {
    existing.lastUsedAt = Date.now()
    return existing.handle
  }

  const pending = inflight.get(key)
  if (pending) return pending

  const promise = (async () => {
    await evictOldest()
    const handle = await openBinding(trimmed || null)
    bindings.set(key, { handle, lastUsedAt: Date.now() })
    startSweeper()
    return handle
  })()

  inflight.set(key, promise)
  try {
    return await promise
  } finally {
    inflight.delete(key)
  }
}

/** Forget a binding the agent no longer knows about (4001). Does not close. */
export function invalidateSlashSession(chatSessionId?: string | null): void {
  const trimmed = typeof chatSessionId === 'string' ? chatSessionId.trim() : ''
  bindings.delete(trimmed || SHARED_KEY)
}

/**
 * Run one RPC against the caller's bound session, re-binding once if the
 * dashboard has forgotten it.
 *
 * 4001 is expected in normal operation: the dashboard restarts, or reaps the
 * session on its own, and our cached handle goes stale. Re-binding and
 * retrying once is the difference between "the first command after a dashboard
 * restart fails" and "it doesn't".
 */
export async function withSlashSession<T>(
  chatSessionId: string | null | undefined,
  run: (handle: string) => Promise<T>,
): Promise<T> {
  const handle = await acquireSlashSession(chatSessionId)
  try {
    return await run(handle)
  } catch (error) {
    if (!(error instanceof HermesRpcError) || error.code !== 4001) throw error
    invalidateSlashSession(chatSessionId)
    const retryHandle = await acquireSlashSession(chatSessionId)
    return run(retryHandle)
  }
}

/** Test seam: drop every binding without touching the agent. */
export function resetSlashSessionsForTest(): void {
  bindings.clear()
  inflight.clear()
  if (sweeper) {
    clearInterval(sweeper)
    sweeper = null
  }
}

/** Test/diagnostic seam. */
export function slashSessionSnapshot(): Array<{
  key: string
  handle: string
  lastUsedAt: number
}> {
  return [...bindings].map(([key, binding]) => ({ key, ...binding }))
}
