/**
 * Persistent JSON-RPC 2.0 WebSocket client for the Hermes dashboard's
 * `/api/ws` sidecar (the `tui_gateway` RPC surface).
 *
 * ── What this talks to ────────────────────────────────────────────────────
 * `${CLAUDE_DASHBOARD_URL}/api/ws` (dashboard, :9119 by default) is mounted in
 * hermes-agent at `hermes_cli/web_server.py` and delegates straight to
 * `tui_gateway.ws.handle_ws` → `tui_gateway.server.dispatch`. That dispatcher
 * is the same one the Ink TUI drives over stdio, so ~120 structured RPCs
 * (`commands.catalog`, `session.*`, `rollback.*`, `billing.*`, …) are reachable
 * here and nowhere else. See `docs/plans/hermes-slash-commands-in-switchui.md`
 * §2.4.
 *
 * ── Why this is NOT `src/server/gateway.ts` ───────────────────────────────
 * `gateway.ts` is structurally the model for this file (reconnect + backoff,
 * inflight map, per-request timeout, circuit breaker) but speaks an entirely
 * different protocol — `{type:'req'|'res'}` envelopes plus an Ed25519 device
 * handshake, to conductor on :18789. None of that envelope is reused here.
 *
 * ── Wire format ───────────────────────────────────────────────────────────
 * Newline-delimited JSON-RPC 2.0, one object per WebSocket text frame:
 *   → `{"jsonrpc":"2.0","id":1,"method":"commands.catalog","params":{}}`
 *   ← `{"jsonrpc":"2.0","id":1,"result":{…}}`
 *   ← `{"jsonrpc":"2.0","id":1,"error":{"code":5020,"message":"…"}}`
 * (`_ok`/`_err`, `tui_gateway/server.py`.)
 *
 * Two things share that socket and must not be confused with responses:
 *   1. `gateway.ready` — an event frame the server writes immediately after
 *      accept, before any request is sent. Consumed, never matched.
 *   2. Async `event` notifications — `{"jsonrpc":"2.0","method":"event",
 *      "params":{"type":…,"payload":…}}`. They carry no `id`, are parked
 *      behind `onHermesRpcEvent()`, and can never settle a pending request.
 *
 * ── Auth ──────────────────────────────────────────────────────────────────
 * `web_server.py::_ws_auth_reason` accepts one of two credentials as a query
 * parameter (browsers cannot set `Authorization` on a WS upgrade):
 *   • loopback / `--insecure` → `?token=<dashboard session token>`
 *   • gated (OAuth) mode      → `?ticket=<single-use>` from
 *     `POST /api/auth/ws-ticket`
 * The ticket is single-use with a 30s TTL, so one is minted per connection
 * attempt and never cached. Which mode the dashboard is in is detected
 * empirically — we try to mint, and fall back to the session token when the
 * mint endpoint rejects us — then remembered until an auth-flavoured close
 * (4401) invalidates the memo.
 *
 * We deliberately send no `Origin` header: `_ws_host_origin_reason` skips the
 * origin check entirely when the header is absent, and any value we invented
 * would only risk a mismatch against the dashboard's bound host.
 */

import WebSocket from 'ws'
import {
  CLAUDE_DASHBOARD_URL,
  dashboardFetch,
  getDashboardToken,
} from './gateway-capabilities'
import type { RawData } from 'ws'

// ── Constants ─────────────────────────────────────────────────────
const RECONNECT_DELAYS_MS = [1000, 2000, 4000]
const MAX_RECONNECT_DELAY_MS = 30_000
const HEARTBEAT_INTERVAL_MS = 30_000
const HEARTBEAT_TIMEOUT_MS = 20_000
const CONNECT_TIMEOUT_MS = 15_000
const AUTH_TIMEOUT_MS = 10_000
const RPC_TIMEOUT_MS = 30_000

// Circuit breaker: stop hammering a dashboard that is down or wedged.
const CIRCUIT_BREAKER_THRESHOLD = 5
const CIRCUIT_BREAKER_COOLDOWN_MS = 10_000

/** WS close code the dashboard uses for a rejected credential. */
export const WS_CLOSE_AUTH_FAILED = 4401
/** WS close code for Host/Origin/peer rejection or embedded chat disabled. */
export const WS_CLOSE_FORBIDDEN = 4403

// ── Types ─────────────────────────────────────────────────────────

export type HermesRpcAuthMode = 'ticket' | 'token'

export type HermesRpcEvent = {
  /** Event discriminator, e.g. `gateway.ready`, `background.complete`. */
  type: string
  payload?: unknown
}

export type HermesRpcEventHandler = (event: HermesRpcEvent) => void

export type HermesRpcFrame =
  | { kind: 'event'; event: HermesRpcEvent }
  | { kind: 'result'; id: string | number; result: unknown }
  | {
      kind: 'error'
      id: string | number | null
      error: { code: number; message: string }
    }
  | { kind: 'unknown' }

/** Error carrying the JSON-RPC `error.code` so callers can branch on it. */
export class HermesRpcError extends Error {
  readonly code: number
  constructor(code: number, message: string) {
    super(message)
    this.name = 'HermesRpcError'
    this.code = code
  }
}

type InflightRequest = {
  method: string
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

type QueuedRequest = InflightRequest & { id: number; params?: unknown }

// ── Pure helpers (exported for tests) ─────────────────────────────

/**
 * Build the `/api/ws` URL for a dashboard base URL and a credential.
 *
 * String surgery rather than `new URL().protocol = 'ws:'` — swapping between
 * special schemes is subtly implementation-dependent, and the base URL here is
 * already normalized by `gateway-capabilities`.
 */
export function buildHermesRpcUrl(
  baseUrl: string,
  param: HermesRpcAuthMode,
  value: string,
): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  const wsBase = trimmed
    .replace(/^https:/i, 'wss:')
    .replace(/^http:/i, 'ws:')
  return `${wsBase}/api/ws?${param}=${encodeURIComponent(value)}`
}

/**
 * Split one WebSocket payload into JSON-RPC objects.
 *
 * The server writes one object per text frame today, but the protocol is
 * documented as newline-delimited (`tui_gateway/ws.py` module docstring) and
 * the stdio transport genuinely batches. Splitting on newlines makes both
 * shapes work; unparseable lines are dropped rather than killing the socket.
 */
export function parseRpcFrames(text: string): Array<unknown> {
  const out: Array<unknown> = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed))
    } catch {
      // Ignore malformed lines — a bad frame must not tear down the transport.
    }
  }
  return out
}

/**
 * Decide what an inbound frame is. Anything that is not an unambiguous
 * `result`/`error` for a real id is treated as an event or discarded — an
 * unmatched notification must never settle a pending request.
 */
export function classifyRpcFrame(raw: unknown): HermesRpcFrame {
  if (!raw || typeof raw !== 'object') return { kind: 'unknown' }
  const frame = raw as Record<string, unknown>

  // Notifications (including `gateway.ready`) arrive as `method: 'event'`
  // with `params: {type, payload}`. Any other notification method is still an
  // event; we surface the method name as the type so nothing is silently lost.
  if (typeof frame.method === 'string') {
    const params = (frame.params ?? {}) as Record<string, unknown>
    const type =
      frame.method === 'event' && typeof params.type === 'string'
        ? params.type
        : frame.method
    return {
      kind: 'event',
      event: { type, payload: frame.method === 'event' ? params.payload : frame.params },
    }
  }

  const id = frame.id
  const hasUsableId = typeof id === 'string' || typeof id === 'number'

  if (frame.error && typeof frame.error === 'object') {
    const err = frame.error as Record<string, unknown>
    return {
      kind: 'error',
      id: hasUsableId ? id : null,
      error: {
        code: typeof err.code === 'number' ? err.code : -32603,
        message: typeof err.message === 'string' ? err.message : 'hermes rpc error',
      },
    }
  }

  if ('result' in frame && hasUsableId) {
    return { kind: 'result', id, result: frame.result }
  }

  return { kind: 'unknown' }
}

export function nextReconnectDelayMs(attempt: number): number {
  if (attempt < RECONNECT_DELAYS_MS.length) return RECONNECT_DELAYS_MS[attempt]
  const doubled =
    RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1] * 2 ** (attempt - 2)
  return Math.min(doubled, MAX_RECONNECT_DELAY_MS)
}

function rawDataToString(data: RawData): string {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return data.toString()
}

/**
 * Mint a single-use WS ticket. Only succeeds when the dashboard is running in
 * gated mode; a loopback/insecure dashboard answers 401 because there is no
 * OAuth session behind the request. Never cached — 30s TTL, one use.
 */
async function mintWsTicket(): Promise<string> {
  const res = await dashboardFetch('/api/auth/ws-ticket', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`ws-ticket mint failed (${res.status})`)
  }
  const body = (await res.json().catch(() => null)) as { ticket?: unknown } | null
  const ticket = typeof body?.ticket === 'string' ? body.ticket.trim() : ''
  if (!ticket) throw new Error('ws-ticket response contained no ticket')
  return ticket
}

// ── Client ────────────────────────────────────────────────────────

export type HermesRpcClientOptions = {
  /** Override the dashboard base URL (tests). Defaults to CLAUDE_DASHBOARD_URL. */
  baseUrl?: () => string
  /** Override credential resolution (tests). */
  resolveUrl?: () => Promise<{ url: string; mode: HermesRpcAuthMode }>
  rpcTimeoutMs?: number
  connectTimeoutMs?: number
}

export class HermesRpcClient {
  private ws: WebSocket | null = null
  private connectPromise: Promise<void> | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeatInterval: NodeJS.Timeout | null = null
  private heartbeatTimeout: NodeJS.Timeout | null = null
  private reconnectAttempts = 0
  private connected = false
  private destroyed = false
  private nextId = 1
  private lastError: string | null = null

  /** Remembered auth mode; cleared on a 4401 so the next attempt re-detects. */
  private authMode: HermesRpcAuthMode | null = null

  private circuitFailures = 0
  private circuitOpen = false
  private circuitOpenedAt = 0

  private queue: Array<QueuedRequest> = []
  private inflight = new Map<number, InflightRequest>()
  private eventListeners = new Set<HermesRpcEventHandler>()

  constructor(private readonly options: HermesRpcClientOptions = {}) {}

  private get rpcTimeoutMs(): number {
    return this.options.rpcTimeoutMs ?? RPC_TIMEOUT_MS
  }

  private get connectTimeoutMs(): number {
    return this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
  }

  onEvent(handler: HermesRpcEventHandler): () => void {
    this.eventListeners.add(handler)
    return () => {
      this.eventListeners.delete(handler)
    }
  }

  getSnapshot(): {
    readyState: number
    connected: boolean
    authMode: HermesRpcAuthMode | null
    circuitOpen: boolean
    lastError: string | null
  } {
    return {
      readyState: this.ws?.readyState ?? WebSocket.CLOSED,
      connected: this.connected,
      authMode: this.authMode,
      circuitOpen: this.circuitOpen,
      lastError: this.lastError,
    }
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    opts?: { timeoutMs?: number },
  ): Promise<T> {
    if (this.destroyed) throw new Error('Hermes RPC client is shut down')

    if (this.circuitOpen) {
      if (Date.now() - this.circuitOpenedAt < CIRCUIT_BREAKER_COOLDOWN_MS) {
        throw new Error(
          `Hermes RPC circuit breaker open (${this.circuitFailures} consecutive failures, cooling down)`,
        )
      }
      // Cooldown elapsed — let one probe through (half-open).
      this.circuitOpen = false
    }

    const id = this.nextId++
    const timeoutMs = opts?.timeoutMs ?? this.rpcTimeoutMs
    let settled = false
    let timer: NodeJS.Timeout | null = null

    return new Promise<T>((resolve, reject) => {
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        fn()
      }

      const entry: QueuedRequest = {
        id,
        method,
        params,
        resolve: (value) => {
          finish(() => {
            this.circuitFailures = 0
            this.circuitOpen = false
            resolve(value as T)
          })
        },
        reject: (reason) => {
          finish(() => {
            this.noteFailure(method)
            reject(reason)
          })
        },
      }

      timer = setTimeout(() => {
        finish(() => {
          this.forget(id)
          this.noteFailure(method)
          reject(new Error(`Hermes RPC timeout after ${timeoutMs}ms for ${method}`))
        })
      }, timeoutMs)
      timer.unref()

      this.queue.push(entry)
      this.ensureConnected().catch((error: unknown) => {
        // The socket could not be established at all (dashboard absent, no
        // usable credential, handshake refused). Fail the request now instead
        // of parking it until the RPC timeout — a capability probe must not
        // block for 30s just because the dashboard is down. Requests already
        // handed to a live socket are untouched; reconnection continues for
        // event subscribers.
        if (this.dropQueued(id)) {
          entry.reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
      this.flushQueue()
    })
  }

  async ensureConnected(): Promise<void> {
    if (this.destroyed) throw new Error('Hermes RPC client is shut down')
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return
    if (this.connectPromise) return this.connectPromise

    this.connectPromise = this.openSocket()
      .then(() => {
        this.reconnectAttempts = 0
      })
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        this.lastError = err.message
        this.scheduleReconnect()
        throw err
      })
      .finally(() => {
        this.connectPromise = null
      })

    return this.connectPromise
  }

  async shutdown(): Promise<void> {
    this.destroyed = true
    this.clearReconnectTimer()
    this.stopHeartbeat()

    const ws = this.ws
    this.ws = null
    this.connected = false

    const error = new Error('Hermes RPC client is shut down')
    this.rejectQueued(error)
    this.rejectInflight(error)

    if (ws) {
      await new Promise<void>((resolve) => {
        if (
          ws.readyState === WebSocket.CLOSED ||
          ws.readyState === WebSocket.CLOSING
        ) {
          resolve()
          return
        }
        ws.once('close', () => resolve())
        try {
          ws.close()
        } catch {
          resolve()
        }
      }).catch(() => undefined)
    }
  }

  /**
   * Resolve a credential and build the connect URL.
   *
   * Detection order when the mode is unknown: try to mint a ticket (gated
   * mode), and on rejection fall back to the session token (loopback /
   * insecure). Once a mode is known we stay on it — a ticket mint failure in
   * known-gated mode is a hard error, because falling back to `?token=` there
   * is exactly what `_ws_auth_reason` refuses.
   */
  private async resolveConnectUrl(): Promise<{
    url: string
    mode: HermesRpcAuthMode
  }> {
    if (this.options.resolveUrl) return this.options.resolveUrl()

    const base = this.options.baseUrl?.() ?? CLAUDE_DASHBOARD_URL

    if (this.authMode !== 'token') {
      try {
        const ticket = await mintWsTicket()
        return { url: buildHermesRpcUrl(base, 'ticket', ticket), mode: 'ticket' }
      } catch (error) {
        if (this.authMode === 'ticket') throw error
        // Mode still unknown — a mint rejection is the expected signal that
        // this dashboard is loopback/insecure. Fall through to the token path.
      }
    }

    const token = await getDashboardToken()
    if (!token) {
      throw new Error(
        'No dashboard session token available for the Hermes RPC WebSocket',
      )
    }
    return { url: buildHermesRpcUrl(base, 'token', token), mode: 'token' }
  }

  private async openSocket(): Promise<void> {
    const { url, mode } = await this.resolveConnectUrl()

    // No Origin header on purpose — see the module header.
    const ws = new WebSocket(url)
    this.clearReconnectTimer()
    this.attachSocket(ws)

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        try {
          ws.terminate()
        } catch {
          /* ignore */
        }
        reject(new Error('Hermes RPC connection timed out'))
      }, this.connectTimeoutMs)
      timer.unref()

      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onError = (error: Error) => {
        cleanup()
        reject(new Error(`Hermes RPC socket error: ${error.message}`))
      }
      const onClose = (code: number, reason: Buffer) => {
        cleanup()
        if (code === WS_CLOSE_AUTH_FAILED) this.authMode = null
        reject(
          new Error(
            `Hermes RPC connection closed during handshake (code=${code}, reason=${reason.toString() || 'n/a'})`,
          ),
        )
      }
      function cleanup() {
        clearTimeout(timer)
        ws.off('open', onOpen)
        ws.off('error', onError)
        ws.off('close', onClose)
      }
      ws.on('open', onOpen)
      ws.on('error', onError)
      ws.on('close', onClose)
    })

    if (this.destroyed) {
      try {
        ws.terminate()
      } catch {
        /* ignore */
      }
      throw new Error('Hermes RPC client is shut down')
    }

    this.ws = ws
    this.authMode = mode
    this.connected = true
    this.lastError = null
    this.circuitFailures = 0
    this.circuitOpen = false
    this.startHeartbeat()
    this.flushQueue()
  }

  private attachSocket(ws: WebSocket) {
    ws.on('message', (data: RawData) => {
      for (const raw of parseRpcFrames(rawDataToString(data))) {
        this.handleFrame(raw)
      }
    })

    ws.on('pong', () => {
      if (this.heartbeatTimeout) {
        clearTimeout(this.heartbeatTimeout)
        this.heartbeatTimeout = null
      }
    })

    ws.on('close', (code: number, reason: Buffer) => {
      if (code === WS_CLOSE_AUTH_FAILED) this.authMode = null
      this.handleDisconnect(
        new Error(
          `Hermes RPC connection closed (code=${code}, reason=${reason.toString() || 'n/a'})`,
        ),
      )
    })

    ws.on('error', (error: unknown) => {
      this.handleDisconnect(
        error instanceof Error ? error : new Error(String(error)),
      )
    })
  }

  private handleFrame(raw: unknown) {
    const frame = classifyRpcFrame(raw)

    if (frame.kind === 'event') {
      // `gateway.ready` lands here too — consumed, never matched to a request.
      for (const listener of this.eventListeners) {
        try {
          listener(frame.event)
        } catch {
          // A listener throwing must not affect the transport.
        }
      }
      return
    }

    if (frame.kind === 'unknown') return

    // A parse-error reply carries `id: null`; it belongs to no request and is
    // dropped rather than failing an arbitrary pending call.
    if (frame.id === null) return

    const key = typeof frame.id === 'number' ? frame.id : Number(frame.id)
    if (!Number.isFinite(key)) return
    const pending = this.inflight.get(key)
    if (!pending) return
    this.inflight.delete(key)

    if (frame.kind === 'result') {
      pending.resolve(frame.result)
      return
    }
    pending.reject(new HermesRpcError(frame.error.code, frame.error.message))
  }

  private handleDisconnect(error: Error) {
    const ws = this.ws
    this.ws = null
    this.connected = false
    this.lastError = error.message
    this.stopHeartbeat()

    if (
      ws &&
      (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
    ) {
      try {
        ws.terminate()
      } catch {
        /* ignore */
      }
    }

    this.rejectInflight(error)

    if (this.destroyed) {
      this.rejectQueued(error)
      return
    }
    this.scheduleReconnect()
  }

  private flushQueue() {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }
    while (this.queue.length > 0) {
      const pending = this.queue.shift()
      if (!pending) continue
      this.inflight.set(pending.id, {
        method: pending.method,
        resolve: pending.resolve,
        reject: pending.reject,
      })
      const payload =
        JSON.stringify({
          jsonrpc: '2.0',
          id: pending.id,
          method: pending.method,
          params: pending.params ?? {},
        }) + '\n'
      try {
        this.ws.send(payload, (err?: Error) => {
          if (!err) return
          this.inflight.delete(pending.id)
          pending.reject(err)
        })
      } catch (error) {
        this.inflight.delete(pending.id)
        pending.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  /**
   * Reconnect only while something still wants the socket. `gateway.ts` loops
   * unconditionally; here an idle capability probe against an absent dashboard
   * must not leave a timer respawning forever (this module is imported during
   * capability probing, including at build time).
   */
  private scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer || this.connectPromise) return
    if (this.queue.length === 0 && this.eventListeners.size === 0) return

    const delay = nextReconnectDelayMs(this.reconnectAttempts)
    this.reconnectAttempts += 1

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.ensureConnected()
        .then(() => this.flushQueue())
        .catch(() => {
          // openSocket() already scheduled the next attempt.
        })
    }, delay)
    this.reconnectTimer.unref()
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      try {
        this.ws.ping()
      } catch {
        this.handleDisconnect(new Error('Hermes RPC ping failed'))
        return
      }
      if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout)
      this.heartbeatTimeout = setTimeout(() => {
        this.heartbeatTimeout = null
        this.handleDisconnect(new Error('Hermes RPC ping timeout'))
      }, HEARTBEAT_TIMEOUT_MS)
      this.heartbeatTimeout.unref()
    }, HEARTBEAT_INTERVAL_MS)
    this.heartbeatInterval.unref()
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout)
      this.heartbeatTimeout = null
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private noteFailure(method: string) {
    this.circuitFailures += 1
    if (this.circuitFailures >= CIRCUIT_BREAKER_THRESHOLD && !this.circuitOpen) {
      this.circuitOpen = true
      this.circuitOpenedAt = Date.now()
      console.warn(
        `[hermes-rpc] Circuit breaker OPEN after ${this.circuitFailures} consecutive failures (last: ${method})`,
      )
    }
  }

  private forget(id: number) {
    if (this.dropQueued(id)) return
    this.inflight.delete(id)
  }

  /** Remove a not-yet-sent request from the queue. True when it was still there. */
  private dropQueued(id: number): boolean {
    const queueIndex = this.queue.findIndex((entry) => entry.id === id)
    if (queueIndex < 0) return false
    this.queue.splice(queueIndex, 1)
    return true
  }

  private rejectQueued(error: Error) {
    const queued = this.queue
    this.queue = []
    for (const pending of queued) pending.reject(error)
  }

  private rejectInflight(error: Error) {
    const pending = [...this.inflight.values()]
    this.inflight.clear()
    for (const entry of pending) entry.reject(error)
  }
}

// ── Singleton ─────────────────────────────────────────────────────
// Survives Vite SSR module reloads, same guard style as gateway.ts.

const HERMES_RPC_KEY = '__hermes_switchui_rpc_client__' as const
declare global {
  var __hermes_switchui_rpc_client__: HermesRpcClient | undefined
}

let client: HermesRpcClient =
  (globalThis as any)[HERMES_RPC_KEY] ?? new HermesRpcClient()
;(globalThis as any)[HERMES_RPC_KEY] = client

export function getHermesRpcClient(): HermesRpcClient {
  return client
}

export async function hermesRpc<T = unknown>(
  method: string,
  params?: unknown,
  opts?: { timeoutMs?: number },
): Promise<T> {
  return client.request<T>(method, params, opts)
}

export function onHermesRpcEvent(handler: HermesRpcEventHandler): () => void {
  return client.onEvent(handler)
}

export function hermesRpcSnapshot() {
  return client.getSnapshot()
}

export async function shutdownHermesRpc(): Promise<void> {
  await client.shutdown()
}

/** Drop the current client and start a fresh one (URL change, tests). */
export async function resetHermesRpcClient(): Promise<void> {
  const previous = client
  client = new HermesRpcClient()
  ;(globalThis as any)[HERMES_RPC_KEY] = client
  await previous.shutdown().catch(() => undefined)
}
