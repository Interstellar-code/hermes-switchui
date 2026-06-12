/**
 * Hermes Switch UI plugin registration + heartbeat sync module.
 *
 * Registers this workspace frontend as a plugin with the Hermes dashboard
 * (:9119) and maintains a heartbeat so the dashboard knows the frontend is
 * alive. All state lives on a globalThis symbol so Vite SSR HMR module
 * re-instantiation cannot double-start timers.
 *
 * Plugin backend API base: /api/plugins/hermes-switch-ui
 *
 * Backend endpoints used:
 *   POST /register   → {ok, compat:{compatible,warn,plugin_range,frontend_version}}
 *   POST /heartbeat  → TTL 90s
 *   GET  /status     → {running,last_heartbeat,ttl_seconds,manifest,reported_settings}
 *   GET  /connection → {gateway_port,dashboard_port,frontend_port,active_profile,enabled_plugins,auth_mode}
 *   POST /settings   → mirror frontend settings (allowlisted keys only)
 *
 * Server-only — never import this module in client-side code.
 */

import { readFileSync } from 'node:fs'

import { dashboardFetch } from './gateway-capabilities'

// ── Constants ──────────────────────────────────────────────────────────────────

const PLUGIN_BASE = '/api/plugins/hermes-switch-ui'
const HEARTBEAT_INTERVAL_MS = 30_000
const HEARTBEAT_BACKOFF_MS = 60_000
const CONSECUTIVE_FAILURE_THRESHOLD = 3
// Must exceed worst-case dashboardFetch auth flow (cold-cache 401 retry ≈ 6s).
const FETCH_TIMEOUT_MS = 12_000

/**
 * Explicit allowlist of settings keys that may be forwarded to the backend.
 * NEVER forward anything not in this list — secrets, tokens, and arbitrary
 * user data must stay client-side.
 *
 * Current list: theme/locale/display toggles + port overrides. Extend here as
 * the workspace settings schema is formalised in P4.
 */
const SETTINGS_ALLOWLIST = new Set<string>([
  'theme',
  'locale',
  'showTimestamps',
  'showTokenCounts',
  'showCostEstimates',
  'enableSoundNotifications',
  'enableDesktopNotifications',
  'compactMode',
  'codeHighlighting',
  'fontSize',
  'customPort',
  'frontendPort',
])

// ── Version (read once) ───────────────────────────────────────────────────────

let _cachedVersion: string | null = null
function getFrontendVersion(): string {
  if (_cachedVersion) return _cachedVersion
  // __APP_VERSION__ is a Vite define (vite.config.ts) replaced at build time in
  // both client and server bundles — require() is NOT available in the Vite SSR
  // ESM runtime and previously made this fall through to 'unknown', which the
  // backend compat check then rejected as unparseable.
  try {
    if (typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0) {
      _cachedVersion = __APP_VERSION__
      return _cachedVersion
    }
  } catch {
    // not defined (e.g. bare vitest run) — fall through to fs read
  }
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
    ) as { version: string }
    _cachedVersion = pkg.version
  } catch {
    _cachedVersion = 'unknown'
  }
  return _cachedVersion
}

// ── Singleton state (all on globalThis) ──────────────────────────────────────

interface PluginSyncState {
  /** Active heartbeat timer (undefined when not running). */
  heartbeatTimer: ReturnType<typeof setInterval> | undefined
  /** Cached compat info from the last successful /register response. */
  compat: {
    compatible: boolean
    warn: string | null
    plugin_range: string | null
    frontend_version: string | null
  } | null
  /** ISO timestamp when registration last succeeded. */
  registeredAt: string | null
  /** Consecutive transient-failure counter (resets on success). */
  consecutiveFailures: number
  /** In-flight register promise — prevents concurrent register calls. */
  registerPromise: Promise<boolean> | null
  /** True when backend returned 404 → plugin routes not mounted. */
  confirmed404: boolean
  /** Current heartbeat interval (ms) — starts at 30s, backs off to 60s. */
  currentIntervalMs: number
}

const _SYNC_STATE_KEY = Symbol.for('hermes.pluginSync')

function _getState(): PluginSyncState {
  const g = globalThis as Record<symbol, unknown>
  if (!g[_SYNC_STATE_KEY]) {
    g[_SYNC_STATE_KEY] = {
      heartbeatTimer: undefined,
      compat: null,
      registeredAt: null,
      consecutiveFailures: 0,
      registerPromise: null,
      confirmed404: false,
      currentIntervalMs: HEARTBEAT_INTERVAL_MS,
    } satisfies PluginSyncState
  }
  return g[_SYNC_STATE_KEY] as PluginSyncState
}

// ── Low-level fetch helper ────────────────────────────────────────────────────

/**
 * Fetch a plugin endpoint, returning the raw Response so callers can inspect
 * the status code (needed to distinguish 404 vs 5xx vs success). Uses the
 * same dashboardFetch used by all other server-side dashboard callers so
 * X-Hermes-Session-Token injection and auth retry are included automatically.
 */
async function pluginFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return dashboardFetch(`${PLUGIN_BASE}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Attempt to register with the backend plugin. Returns true on success.
 * Caches the compat info and registeredAt from the response.
 * On confirmed 404 sets the confirmed404 flag so the loop stops.
 * On transient failure (timeout / 5xx / auth) returns false without setting
 * the confirmed404 flag.
 *
 * Concurrent calls share the in-flight promise to guarantee register-once
 * semantics even when multiple server paths warm up simultaneously.
 */
async function ensureRegistered(): Promise<boolean> {
  const state = _getState()

  // Already registered and backend has not gone 404.
  if (state.registeredAt && !state.confirmed404) return true

  // Confirmed-absent: do not retry in the loop (lazy retry on next snapshot).
  if (state.confirmed404) return false

  // Deduplicate concurrent register calls.
  if (state.registerPromise) return state.registerPromise

  state.registerPromise = _doRegister().finally(() => {
    state.registerPromise = null
  })
  return state.registerPromise
}

async function _doRegister(): Promise<boolean> {
  const state = _getState()
  const port = Number(process.env.PORT) || 3000
  const hermesApiUrl = process.env.HERMES_API_URL ?? 'http://127.0.0.1:8642'
  const version = getFrontendVersion()

  const payload = {
    version,
    url: `http://localhost:${port}`,
    port,
    hermes_api_url: hermesApiUrl,
    // Provisional list — semantics not yet defined by backend (plan §finding 14).
    enabled_features: ['chat', 'workflows', 'terminal', 'files', 'memory'],
  }

  let res: Response
  try {
    res = await pluginFetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    // Timeout / network error → transient failure, do not set confirmed404.
    return false
  }

  if (res.status === 404) {
    state.confirmed404 = true
    console.log('[hermes-plugin-sync] Plugin routes not mounted on dashboard (404) — heartbeat disabled')
    return false
  }

  if (!res.ok) {
    // 5xx / 401 → transient; will retry on next tick.
    return false
  }

  try {
    const body = (await res.json()) as {
      ok?: boolean
      compat?: {
        compatible?: boolean
        warn?: string | null
        plugin_range?: string | null
        frontend_version?: string | null
      } | null
    }
    state.compat = {
      compatible: body.compat?.compatible ?? true,
      warn: body.compat?.warn ?? null,
      plugin_range: body.compat?.plugin_range ?? null,
      frontend_version: body.compat?.frontend_version ?? null,
    }
  } catch {
    // Unexpected body shape — treat as compatible but no compat info.
    state.compat = { compatible: true, warn: null, plugin_range: null, frontend_version: null }
  }

  state.registeredAt = new Date().toISOString()
  state.consecutiveFailures = 0
  console.log(`[hermes-plugin-sync] Registered with dashboard (v${version})`)
  return true
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

async function _tickHeartbeat(): Promise<void> {
  const state = _getState()

  // If plugin was confirmed absent, stop the loop.
  if (state.confirmed404) {
    _stopHeartbeat()
    return
  }

  // Must be registered before heartbeating — NEVER heartbeat before a
  // successful register.
  const registered = await ensureRegistered()
  if (!registered) {
    state.consecutiveFailures++
    _adjustInterval()
    return
  }

  let res: Response
  try {
    res = await pluginFetch('/heartbeat', { method: 'POST' })
  } catch {
    // Timeout / network error.
    state.consecutiveFailures++
    _adjustInterval()
    return
  }

  if (res.status === 404) {
    // Plugin was unloaded at runtime — reset so re-probe can re-register.
    state.confirmed404 = true
    state.registeredAt = null
    state.compat = null
    _stopHeartbeat()
    console.log('[hermes-plugin-sync] Heartbeat 404 — plugin unloaded, stopping loop')
    return
  }

  if (!res.ok) {
    state.consecutiveFailures++
    _adjustInterval()
    console.warn(`[hermes-plugin-sync] Heartbeat non-ok status ${res.status}`)
    return
  }

  // Success: reset failure counter and restore normal interval if it was backed
  // off.
  if (state.consecutiveFailures > 0) {
    state.consecutiveFailures = 0
    _setInterval(HEARTBEAT_INTERVAL_MS)
    console.log('[hermes-plugin-sync] Heartbeat restored — backoff cleared')
  }
}

function _adjustInterval(): void {
  const state = _getState()
  if (state.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
    _setInterval(HEARTBEAT_BACKOFF_MS)
    if (state.consecutiveFailures === CONSECUTIVE_FAILURE_THRESHOLD) {
      console.warn('[hermes-plugin-sync] 3 consecutive failures — backing off to 60s')
    }
  }
}

function _setInterval(ms: number): void {
  const state = _getState()
  if (state.currentIntervalMs === ms) return
  state.currentIntervalMs = ms
  // Restart timer with new interval.
  _stopHeartbeat()
  _startTimer()
}

function _stopHeartbeat(): void {
  const state = _getState()
  if (state.heartbeatTimer !== undefined) {
    clearInterval(state.heartbeatTimer)
    state.heartbeatTimer = undefined
  }
}

function _startTimer(): void {
  const state = _getState()
  if (state.heartbeatTimer !== undefined) return
  const timer = setInterval(() => {
    void _tickHeartbeat()
  }, state.currentIntervalMs)
  // timer.unref() so Node.js can exit cleanly without waiting for the interval.
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    ;(timer as { unref(): void }).unref()
  }
  state.heartbeatTimer = timer
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Idempotent. Called once from gateway-capabilities.ts after probe success.
 * Starts the register+heartbeat loop if not already running.
 */
export function ensureHermesPluginSync(): void {
  const state = _getState()
  // If timer is already running or plugin was confirmed absent, do nothing.
  if (state.heartbeatTimer !== undefined || state.confirmed404) return
  // Kick off registration and then start the timer.
  void ensureRegistered().then((registered) => {
    if (registered) {
      _startTimer()
    }
  })
}

export type HermesPluginSnapshot = {
  pluginAvailable: boolean
  backendReachable: boolean
  status: {
    running: boolean
    last_heartbeat: string | null
    ttl_seconds: number
    manifest: Record<string, unknown> | null
    reported_settings: Record<string, unknown> | null
  } | null
  connection: {
    gateway_port: number | null
    dashboard_port: number | null
    frontend_port: number | null
    active_profile: string | null
    enabled_plugins: string[]
    auth_mode: string | null
  } | null
  compat: {
    compatible: boolean
    warn: string | null
    plugin_range: string | null
    frontend_version: string | null
  } | null
  registeredAt: string | null
}

/**
 * Returns the current plugin snapshot. Always HTTP-200-safe (degraded is a
 * state, not an error).
 *
 * - 404 from backend → pluginAvailable:false, backendReachable:true
 * - timeout/5xx/auth → backendReachable:false, pluginAvailable shape unknown
 * - both ok → pluginAvailable:true, backendReachable:true
 */
export async function getPluginSnapshot(): Promise<HermesPluginSnapshot> {
  // Ensure the sync loop has been kicked off.
  ensureHermesPluginSync()

  const state = _getState()

  // If confirmed 404, re-probe lazily (plugin might have been re-enabled).
  if (state.confirmed404) {
    const recovered = await ensureRegistered()
    if (recovered) {
      state.confirmed404 = false
      _startTimer()
    } else if (state.confirmed404) {
      // Still 404 — plugin definitively absent.
      return {
        pluginAvailable: false,
        backendReachable: true,
        status: null,
        connection: null,
        compat: state.compat,
        registeredAt: state.registeredAt,
      }
    }
  }

  // Attempt to ensure registered before fetching status/connection.
  const registered = await ensureRegistered()

  // If registration just confirmed 404 (plugin routes not mounted), return early
  // before firing the parallel status+connection fetches.
  if (state.confirmed404) {
    return {
      pluginAvailable: false,
      backendReachable: true,
      status: null,
      connection: null,
      compat: state.compat,
      registeredAt: state.registeredAt,
    }
  }

  // Fetch /status and /connection in parallel.
  const [statusResult, connectionResult] = await Promise.allSettled([
    pluginFetch('/status'),
    pluginFetch('/connection'),
  ])

  // Interpret the status response.
  let pluginAvailable = true
  let backendReachable = true
  let statusData: HermesPluginSnapshot['status'] = null
  let connectionData: HermesPluginSnapshot['connection'] = null

  // Helper to classify a fetch SettledResult.
  const classify = (
    result: PromiseSettledResult<Response>,
    label: string,
  ): { ok: boolean; res: Response | null; is404: boolean; isTransient: boolean } => {
    if (result.status === 'rejected') {
      // Timeout / network error.
      console.warn(`[hermes-plugin-sync] ${label} unreachable: ${String(result.reason)}`)
      return { ok: false, res: null, is404: false, isTransient: true }
    }
    const res = result.value
    if (res.status === 404) return { ok: false, res, is404: true, isTransient: false }
    if (!res.ok) return { ok: false, res, is404: false, isTransient: true }
    return { ok: true, res, is404: false, isTransient: false }
  }

  const statusClassified = classify(statusResult, '/status')
  const connClassified = classify(connectionResult, '/connection')

  // Determine overall availability.
  if (statusClassified.is404 || connClassified.is404) {
    pluginAvailable = false
    backendReachable = true
  } else if (statusClassified.isTransient || connClassified.isTransient) {
    backendReachable = false
  }

  // Parse status body.
  if (statusClassified.ok && statusClassified.res) {
    try {
      const raw = (await statusClassified.res.json()) as {
        running?: boolean
        last_heartbeat?: string | null
        ttl_seconds?: number
        manifest?: Record<string, unknown> | null
        reported_settings?: Record<string, unknown> | null
      }
      statusData = {
        running: raw.running ?? false,
        last_heartbeat: raw.last_heartbeat ?? null,
        ttl_seconds: raw.ttl_seconds ?? 90,
        manifest: raw.manifest ?? null,
        reported_settings: raw.reported_settings ?? null,
      }
    } catch {
      // Malformed body — treat as transient.
      backendReachable = false
    }
  }

  // Parse connection body.
  if (connClassified.ok && connClassified.res) {
    try {
      const raw = (await connClassified.res.json()) as {
        gateway_port?: number | null
        dashboard_port?: number | null
        frontend_port?: number | null
        active_profile?: string | null
        enabled_plugins?: string[]
        auth_mode?: string | null
      }
      connectionData = {
        gateway_port: raw.gateway_port ?? null,
        dashboard_port: raw.dashboard_port ?? null,
        frontend_port: raw.frontend_port ?? null,
        active_profile: raw.active_profile ?? null,
        enabled_plugins: Array.isArray(raw.enabled_plugins) ? raw.enabled_plugins : [],
        auth_mode: raw.auth_mode ?? null,
      }
    } catch {
      backendReachable = false
    }
  }

  // If we never registered successfully, compat is still null (UNKNOWN).
  return {
    pluginAvailable: pluginAvailable && backendReachable,
    backendReachable,
    status: statusData,
    connection: connectionData,
    // null = registration not yet succeeded (compat UNKNOWN)
    compat: registered ? state.compat : null,
    registeredAt: state.registeredAt,
  }
}

/**
 * Forward allowlisted settings to the backend plugin settings endpoint.
 * Strips any key not in SETTINGS_ALLOWLIST before sending. Never logs payloads.
 * Returns {ok:false} on 413/422 or network error.
 */
export async function forwardSettings(settings: Record<string, unknown>): Promise<{ ok: boolean }> {
  // Strip non-allowlisted keys.
  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(settings)) {
    if (SETTINGS_ALLOWLIST.has(k)) {
      safe[k] = v
    }
  }

  let res: Response
  try {
    res = await pluginFetch('/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(safe),
    })
  } catch {
    console.warn('[hermes-plugin-sync] forwardSettings: network error')
    return { ok: false }
  }

  if (res.status === 413 || res.status === 422) {
    console.warn(`[hermes-plugin-sync] forwardSettings: backend rejected payload (${res.status})`)
    return { ok: false }
  }

  if (!res.ok) {
    console.warn(`[hermes-plugin-sync] forwardSettings: non-ok status ${res.status}`)
    return { ok: false }
  }

  return { ok: true }
}
