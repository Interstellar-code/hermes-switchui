/**
 * Simple in-memory rate limiter (no external deps).
 * Uses a sliding window approach per key.
 */

/** Maximum number of IP×endpoint keys retained. Oldest entries are evicted first. */
const MAX_STORE_SIZE = 50_000

/**
 * Conservative cleanup horizon: 24 h ensures timestamps are never silently
 * purged before any realistic windowMs value.
 */
const CLEANUP_HORIZON_MS = 86_400_000

const store = new Map<string, { timestamps: Array<number> }>()

// Cleanup interval — configurable via RATE_LIMIT_CLEANUP_MS (default 2 min)
const _cleanupIntervalMs = (() => {
  const v = parseInt(process.env.RATE_LIMIT_CLEANUP_MS ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : 120_000
})()

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < CLEANUP_HORIZON_MS)
    if (entry.timestamps.length === 0) store.delete(key)
  }
}, _cleanupIntervalMs)

/**
 * Check if a request is allowed under the rate limit.
 * @returns true if allowed, false if blocked
 */
export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now()
  let entry = store.get(key)
  if (!entry) {
    // Evict oldest entry when cap is reached
    if (store.size >= MAX_STORE_SIZE) {
      const oldestKey = store.keys().next().value
      if (oldestKey !== undefined) store.delete(oldestKey)
    }
    entry = { timestamps: [] }
    store.set(key, entry)
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)

  if (entry.timestamps.length >= maxRequests) {
    return false
  }

  entry.timestamps.push(now)
  return true
}

/**
 * Extract client IP from request for rate limiting key.
 *
 * Honors `x-forwarded-for` only when `TRUST_PROXY=1` is set — otherwise a
 * client-controlled header could trivially rotate the rate-limit key. See
 * #125. When no trusted forwarded header is present, fall back to the
 * request's remote address, or a static `local` bucket when the adapter
 * does not expose one (tests / raw fetch).
 */
export function getClientIp(request: Request): string {
  const trustProxy = (() => {
    const v = (process.env.TRUST_PROXY || '').trim().toLowerCase()
    return v === '1' || v === 'true' || v === 'yes'
  })()
  if (trustProxy) {
    const forwarded = request.headers.get('x-forwarded-for')
    const first = forwarded?.split(',')[0]?.trim()
    if (first) return first
    const real = request.headers.get('x-real-ip')?.trim()
    if (real) return real
  }
  const maybeAddress = (request as unknown as { remoteAddress?: string })
    .remoteAddress
  return (maybeAddress && maybeAddress.trim()) || 'local'
}

/**
 * Return a 429 Too Many Requests response.
 */
export function rateLimitResponse(): Response {
  return new Response(
    JSON.stringify({ error: 'Too many requests, please try again later' }),
    {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

/**
 * Lightweight CSRF check: reject POST/PUT/PATCH/DELETE that don't send
 * `Content-Type: application/json`. Browsers won't set this header on
 * a simple form/navigation request, so its presence indicates a
 * programmatic call (JS fetch, curl, etc.).
 *
 * Returns `null` when the check passes, or a 415 Response to send back.
 */
export function requireJsonContentType(request: Request): Response | null {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null
  const ct = request.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return null
  return new Response(
    JSON.stringify({ error: 'Content-Type must be application/json' }),
    { status: 415, headers: { 'Content-Type': 'application/json' } },
  )
}

/**
 * Sanitize error for response — hide details in production.
 */
export function safeErrorMessage(err: unknown): string {
  if (process.env.NODE_ENV === 'production') {
    return 'Internal server error'
  }
  return err instanceof Error ? err.message : String(err)
}
