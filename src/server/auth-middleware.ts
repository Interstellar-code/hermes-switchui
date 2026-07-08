import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Persistent session token store.
 *
 * Tokens are held in memory for fast lookup and persisted to a JSON file
 * so they survive server restarts.  This is safe for single-instance
 * deployments.  For multi-worker setups the file becomes a race-condition
 * window — in that case replace with Redis or a database.
 *
 * File location: ~/.hermes/workspace-sessions.json
 */
interface SessionStore {
  tokens: Record<string, number> // token -> expiry unix-ms
}

const STORE_FILE = join(
  process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? join(homedir(), '.hermes'),
  'workspace-sessions.json',
)
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/** Hash a raw token for storage. Prefix makes hashed vs plain distinguishable. */
function hashToken(raw: string): string {
  return 'sha256:' + createHash('sha256').update(raw).digest('hex')
}

function loadStore(): { store: SessionStore; needsMigration: boolean } {
  // Ensure parent directory has restrictive permissions.
  const dir = dirname(STORE_FILE)
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    } else {
      const dirStat = statSync(dir)
      if (dirStat.mode & 0o077) {
        console.warn(
          `[auth] ${dir} is world/group accessible (mode ${(dirStat.mode & 0o777).toString(8)}); fixing to 0700`,
        )
        try { chmodSync(dir, 0o700) } catch { /* best-effort */ }
      }
    }
  } catch {
    // Non-fatal — continue loading.
  }

  try {
    if (existsSync(STORE_FILE)) {
      // Check file permissions before reading.
      try {
        const fileStat = statSync(STORE_FILE)
        if (fileStat.mode & 0o077) {
          console.warn(
            `[auth] ${STORE_FILE} is world/group accessible (mode ${(fileStat.mode & 0o777).toString(8)}); fixing to 0600`,
          )
          try { chmodSync(STORE_FILE, 0o600) } catch { /* best-effort */ }
        }
      } catch {
        // Non-fatal.
      }

      const raw = readFileSync(STORE_FILE, 'utf8')
      const parsed = JSON.parse(raw) as SessionStore
      // Expire stale tokens and detect whether any plain (unhashed) tokens
      // need migrating to sha256 hashes.
      const now = Date.now()
      const valid: Record<string, number> = {}
      let hasPlain = false
      for (const [token, expiry] of Object.entries(parsed.tokens)) {
        if (expiry > now) {
          if (token.startsWith('sha256:')) {
            valid[token] = expiry
          } else {
            // Plain token from before the hashing migration — re-key as hash.
            valid[hashToken(token)] = expiry
            hasPlain = true
          }
        }
      }
      return { store: { tokens: valid }, needsMigration: hasPlain }
    }
  } catch (err) {
    // Corrupt store — start fresh and log so operators know.
    console.warn(`[auth] Failed to load session store (${STORE_FILE}); starting fresh:`, err)
  }
  return { store: { tokens: {} }, needsMigration: false }
}

function saveStore(store: SessionStore): void {
  const tmp = `${STORE_FILE}.${process.pid}.tmp`
  try {
    const dir = dirname(STORE_FILE)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
    // Write to a temp file born 0600, then rename atomically so the target
    // file is never visible with looser permissions (chmod-after-write race).
    writeFileSync(tmp, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, STORE_FILE)
  } catch {
    // Non-fatal — tokens are still in memory.
    console.warn(`[auth] Failed to persist session store to ${STORE_FILE}`)
    try { unlinkSync(tmp) } catch { /* best-effort cleanup */ }
  }
}

// In-memory working copy
const _tokens: Map<string, number> = new Map()

// Hydrate from disk on module load; persist immediately if plain tokens were migrated.
const { store: _initial, needsMigration: _needsMigration } = loadStore()
for (const [token, expiry] of Object.entries(_initial.tokens)) {
  _tokens.set(token, expiry)
}

// --- Serialized write queue (#73 write-race fix) ---
// All disk writes are funnelled through this promise chain so concurrent
// storeSessionToken / revokeSessionToken calls never clobber each other.
let _writeQueue: Promise<void> = Promise.resolve()

/**
 * Prune expired tokens from the store (called on every write + a periodic sweep).
 */
function _prune(): void {
  const now = Date.now()
  let changed = false
  for (const [token, expiry] of _tokens) {
    if (expiry <= now) {
      _tokens.delete(token)
      changed = true
    }
  }
  if (changed) _persist()
}

function _persist(): void {
  const snapshot = Object.fromEntries(_tokens)
  _writeQueue = _writeQueue.then(() => {
    saveStore({ tokens: snapshot })
  })
}

// Sweep expired tokens every 10 minutes
setInterval(_prune, 10 * 60 * 1000)

// Persist migrated (hashed) tokens to disk now that the write queue is set up.
if (_needsMigration) _persist()

/**
 * Generate a cryptographically secure session token.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Store a session token as valid (30-day TTL).
 * Only the sha256 hash of the token is written to disk (#73).
 */
export function storeSessionToken(token: string): void {
  _tokens.set(hashToken(token), Date.now() + TOKEN_TTL_MS)
  _persist()
}

/**
 * Check if a session token is valid and not expired.
 * Compares against the stored hash (#73).
 */
export function isValidSessionToken(token: string): boolean {
  const key = hashToken(token)
  const expiry = _tokens.get(key)
  if (expiry === undefined) return false
  if (expiry <= Date.now()) {
    _tokens.delete(key)
    _persist()
    return false
  }
  return true
}

/**
 * Remove a session token (logout).
 */
export function revokeSessionToken(token: string): void {
  _tokens.delete(hashToken(token))
  _persist()
}

/**
 * Resolve the configured workspace password.
 *
 * Honors HERMES_PASSWORD first (current name, post-rename) and falls back to
 * CLAUDE_PASSWORD for back-compat with deployments configured pre-rename.
 */
function getConfiguredPassword(): string {
  const fromHermes = process.env.HERMES_PASSWORD
  if (fromHermes && fromHermes.length > 0) return fromHermes
  const fromClaude = process.env.CLAUDE_PASSWORD
  if (fromClaude && fromClaude.length > 0) return fromClaude
  return ''
}

/**
 * Check if password protection is enabled.
 */
export function isPasswordProtectionEnabled(): boolean {
  return getConfiguredPassword().length > 0
}

/**
 * Verify password using timing-safe comparison.
 *
 * Both the submitted and configured passwords are SHA-256 hashed before
 * comparison so the inputs are always fixed-length 32-byte digests.  This
 * eliminates the password-length side-channel that an early return on raw
 * length mismatch would otherwise leak (#150).
 */
export function verifyPassword(password: string): boolean {
  const configured = getConfiguredPassword()
  if (!configured || configured.length === 0) {
    return false
  }

  // Hash to fixed-length digests so timingSafeEqual never short-circuits on
  // differing input lengths.
  const providedHash = createHash('sha256').update(password).digest()
  const configuredHash = createHash('sha256').update(configured).digest()

  try {
    return timingSafeEqual(providedHash, configuredHash)
  } catch {
    return false
  }
}

/**
 * Extract session token from cookie header.
 */
export function getSessionTokenFromCookie(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';').map((c) => c.trim())
  for (const cookie of cookies) {
    if (cookie.startsWith('claude-auth=')) {
      return cookie.substring('claude-auth='.length)
    }
  }
  return null
}

/**
 * Whether the workspace is configured to trust proxy-forwarded headers
 * (`x-forwarded-for`, `x-real-ip`). Off by default — enabled explicitly when
 * deployed behind a trusted reverse proxy (Traefik, Nginx, Cloudflare).
 * See #125.
 */
function isTrustedProxyEnabled(): boolean {
  const v = (process.env.TRUST_PROXY || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Best-effort extraction of the peer IP, preferring the actual socket
 * address when available. Forwarded headers are only honored when
 * TRUST_PROXY is set — otherwise a client-controlled `x-forwarded-for`
 * could spoof local classification (#125).
 */
export function getRequestIp(request: Request): string {
  if (isTrustedProxyEnabled()) {
    const forwarded = request.headers.get('x-forwarded-for')
    const first = forwarded?.split(',')[0]?.trim()
    if (first) return first
    const real = request.headers.get('x-real-ip')?.trim()
    if (real) return real
  }
  // Node's Request does not expose the socket; the adapter that constructs it
  // (TanStack Start / undici) may attach `remoteAddress` under a well-known
  // symbol. Fall back to loopback when nothing is available so we fail *safe*
  // (no LAN/Tailscale bypass for unknown peers).
  const maybeAddress = (request as unknown as { remoteAddress?: string })
    .remoteAddress
  return (maybeAddress && maybeAddress.trim()) || '127.0.0.1'
}

function isLocalRequest(request: Request): boolean {
  const ip = getRequestIp(request)
  const localIPs = ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']
  if (localIPs.includes(ip)) return true
  // Allow Tailscale (100.x.x.x) and private LAN ranges
  if (/^100\.\d+\.\d+\.\d+$/.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^10\./.test(ip)) return true
  return false
}

/**
 * Check if the request is authenticated.
 * Returns true if:
 * - Password protection is disabled, OR
 * - Request has a valid session token
 */
export function isAuthenticated(request: Request): boolean {
  // No password configured? No auth needed
  if (!isPasswordProtectionEnabled()) {
    return true
  }

  // Check for valid session token
  const cookieHeader = request.headers.get('cookie')
  const token = getSessionTokenFromCookie(cookieHeader)

  if (!token) {
    return false
  }

  return isValidSessionToken(token)
}

/**
 * Gate for routes that should be accessible locally OR by authenticated users.
 *
 * Behavior matrix:
 *   bind=127.0.0.1, no password          → allow (loopback; password check
 *                                           irrelevant, returns true immediately)
 *   bind=0.0.0.0, password set            → require valid session token (strict)
 *   bind=0.0.0.0, no password,
 *     TRUST_PROXY set                     → allow unconditionally; operators
 *                                           deploying behind a trusted reverse
 *                                           proxy with no password intend open
 *                                           access for all proxied users
 *   bind=0.0.0.0, no password,
 *     TRUST_PROXY NOT set                 → allow unconditionally; no-password
 *                                           mode is "open access" by design
 *                                           (operator's responsibility to bind
 *                                           only on a trusted interface)
 *
 * When HERMES_PASSWORD is unset the design intent is open access — mirroring
 * `isAuthenticated` which also returns true immediately. Restricting to
 * loopback-only broke legitimate users behind reverse proxies (#68).
 */
export function requireLocalOrAuth(request: Request): boolean {
  if (!isPasswordProtectionEnabled()) {
    // No password configured → open access (same as isAuthenticated).
    return true
  }

  return isAuthenticated(request)
}

/**
 * Whether session cookies should set the `Secure` attribute.
 *
 * Defaults ON in production, OFF in development (so localhost-over-HTTP
 * login flows still work). Operators can override with
 * `COOKIE_SECURE=0` (force off) or `COOKIE_SECURE=1` (force on). See #123.
 */
function shouldSetSecureCookie(): boolean {
  const override = (process.env.COOKIE_SECURE || '').trim().toLowerCase()
  if (override === '1' || override === 'true' || override === 'yes') return true
  if (override === '0' || override === 'false' || override === 'no') return false
  return process.env.NODE_ENV === 'production'
}

/**
 * Create a Set-Cookie header for the session token.
 *
 * Attributes:
 *   - HttpOnly    — blocks JS access, mitigates XSS session theft
 *   - Secure      — HTTPS only (production default, overridable)
 *   - SameSite=Strict — CSRF protection
 *   - Path=/      — available across the whole app
 *   - Max-Age     — 30 days
 */
export function createSessionCookie(token: string): string {
  const attrs = ['HttpOnly']
  if (shouldSetSecureCookie()) attrs.push('Secure')
  attrs.push('SameSite=Strict', 'Path=/', `Max-Age=${30 * 24 * 60 * 60}`)
  return `claude-auth=${token}; ${attrs.join('; ')}`
}
