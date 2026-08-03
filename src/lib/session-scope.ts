/**
 * Composite session identity — `profile + sessionId`.
 *
 * Hermes profiles are separate data homes, each with its own `state.db`, so a
 * bare session ID is NOT unique across profiles: two profiles can legitimately
 * hold the same ID. Anything that keys client-side state (query keys, store
 * maps, sessionStorage slots) by a bare ID will silently serve one profile's
 * data into another profile's UI.
 *
 * This module is the single construction point for the composite key. Per
 * `.omc/research/p0a-safety-contract.md` §2.2 the serialized form is:
 *
 *   profile === null  ->  `${sessionId}`              (unscoped / legacy)
 *   profile !== null  ->  `${profile}::${sessionId}`  (explicitly scoped)
 *
 * `'::'` is safe as a separator: profile names and gateway session IDs never
 * contain it.
 *
 * The unscoped form is deliberately byte-identical to today's bare key. That is
 * the §2 definition of done: single-profile users keep the exact same cache
 * keys, the exact same sessionStorage slots, and therefore the exact same
 * behaviour — scoping is additive, never a migration.
 */

/** Canonical composite identity. `profile: null` = legacy/unscoped. */
export type SessionScope = { profile: string | null; sessionId: string }

const SCOPE_SEPARATOR = '::'

/**
 * Normalize an arbitrary profile input to the canonical `string | null`.
 * Empty/blank/non-string all mean "no explicit profile" — never `'default'`,
 * which is a real profile name (P0A §1.1).
 */
export function normalizeProfile(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Build the composite key. Unscoped returns the bare id unchanged.
 *
 * Accepts the positional form for call-site ergonomics; `scopeKeyOf` takes the
 * `SessionScope` record spelled in the P0A contract.
 */
export function scopeKey(
  profile: string | null | undefined,
  sessionId: string,
): string {
  const normalized = normalizeProfile(profile)
  if (!normalized || !sessionId) return sessionId
  const prefix = `${normalized}${SCOPE_SEPARATOR}`
  // Idempotent: scoping an already-scoped key is a no-op. Session IDs never
  // contain '::', so this can only match a key we built ourselves. Without it
  // any layer that scopes at more than one depth (a store action calling
  // another store action) would produce `p::p::id`.
  if (sessionId.startsWith(prefix)) return sessionId
  return `${prefix}${sessionId}`
}

/** P0A §2.2 signature: `scopeKey(s: SessionScope): string`. */
export function scopeKeyOf(scope: SessionScope): string {
  return scopeKey(scope.profile, scope.sessionId)
}

/** Inverse of {@link scopeKey}. A bare key parses back to `profile: null`. */
export function parseScopeKey(key: string): SessionScope {
  const at = key.indexOf(SCOPE_SEPARATOR)
  if (at < 0) return { profile: null, sessionId: key }
  return {
    profile: key.slice(0, at),
    sessionId: key.slice(at + SCOPE_SEPARATOR.length),
  }
}

/**
 * Scope segments for keys that identify a *collection* rather than one session
 * (a session list, a capability probe). Spread into a query key tail:
 *
 *   ['chat', 'sessions', ...scopeSegments(profile)]
 *
 * Empty when unscoped, so the key stays byte-identical to today's.
 */
export function scopeSegments(
  profile: string | null | undefined,
): Array<string> {
  const normalized = normalizeProfile(profile)
  return normalized ? [normalized] : []
}

// ── Ambient profile ────────────────────────────────────────────────────────
//
// The profile the chat surface is currently viewing. Single writer: the
// `/chat/$sessionKey` route, from its `?profile=` search param (set in
// `beforeLoad`, i.e. before the subtree renders). Everything that builds a
// session-derived key — query keys, chat-store map keys, sessionStorage slots —
// reads it from here rather than taking a `profile` parameter.
//
// Why ambient and not a prop/context: the key builders are the enforcement
// point. If profile were a parameter, a future key could simply omit it and
// silently go bare — the exact bug this module exists to kill. Reading it here
// means a bare key is not expressible.
//
// ponytail: one profile per tab. Rendering two profiles side by side would need
// a real context; add it when a surface actually shows two at once.

let ambientProfile: string | null = null

/**
 * Set the ambient profile. Returns true when the value actually changed.
 *
 * No-op on the server: module state there is shared across every request, so a
 * write would leak one user's profile into another's render. Every consumer
 * (query cache, chat-store, sessionStorage) is client-only anyway.
 */
export function setSessionProfile(profile: unknown): boolean {
  if (typeof window === 'undefined') return false
  const next = normalizeProfile(profile)
  if (next === ambientProfile) return false
  ambientProfile = next
  return true
}

export function getSessionProfile(): string | null {
  return ambientProfile
}

/** Every route whose subtree may legitimately hold a scoped profile. */
const PROFILE_SCOPED_PATH_PREFIX = '/chat'

/**
 * Drop the ambient profile once the app is no longer on the chat surface.
 *
 * Only `/chat/$sessionKey` ever sets it, but module state outlives the route:
 * without this, leaving a scoped chat for `/dashboard` leaves `neo` ambient, and
 * the floating chat panel — which renders on those routes with no `?profile=` —
 * would write into `neo` while showing the unscoped session.
 *
 * Deliberately derived from the *resolved* pathname rather than from a leave
 * hook. An unmount/`onLeave` clear races the next route's `beforeLoad`: chat →
 * chat navigation (session-to-session, and the new-chat → real-session swap)
 * would set the profile and then have the outgoing match blank it. A pathname
 * check has no ordering to get wrong — during in-chat navigation the path never
 * stops being `/chat`, so there is no moment at which it clears.
 */
export function syncSessionProfileToPath(pathname: string): void {
  if (!pathname.startsWith(PROFILE_SCOPED_PATH_PREFIX)) setSessionProfile(null)
}

/** Composite key for the ambient profile — the form nearly every caller wants. */
export function activeScopeKey(sessionId: string): string {
  return scopeKey(ambientProfile, sessionId)
}

/** Scope segments for the ambient profile. */
export function activeScopeSegments(): Array<string> {
  return scopeSegments(ambientProfile)
}

// ── Wire ───────────────────────────────────────────────────────────────────
//
// The client half of the fail-closed contract. The server (`profile-scope.ts`)
// refuses a scoped write it cannot prove is routable, but it can only do that
// for a profile it was actually told about — `body.profile`. A write that
// forgets to carry the profile is not rejected, it is silently treated as
// unscoped and lands in whatever profile the gateway happens to be running.
// That is the whole hazard, so every client write spreads `profileBody()`.

/**
 * Body fragment carrying the ambient profile. Spreads to `{}` when unscoped,
 * which keeps single-profile request bodies byte-identical to before.
 */
export function profileBody(): { profile?: string } {
  return ambientProfile ? { profile: ambientProfile } : {}
}

/** Prefix marking a message as a refusal (nothing was sent) rather than a
 *  failure (something broke). The UI words the two differently. */
export const PROFILE_REFUSAL_PREFIX = 'Not sent — '

export function isProfileRefusal(message: string): boolean {
  return message.startsWith(PROFILE_REFUSAL_PREFIX)
}

/**
 * Turn a non-OK write response into a user-facing message.
 *
 * A 409 (topology unprovable) or 404 (profile not served) on a request we
 * scoped is the server's typed refusal — surface its reason verbatim and mark
 * it, so it never reads as a generic network blip or vanishes into a no-op.
 */
export async function readSendFailure(
  response: Response,
  profile: string | null = ambientProfile,
): Promise<string> {
  const raw = await response.text().catch(() => '')
  let detail = raw
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // `error` is our own route shape; `message`/`detail` come from a gateway
    // body passed straight through by clarify/respond.
    const message = parsed.error ?? parsed.message ?? parsed.detail
    if (typeof message === 'string' && message.trim()) detail = message.trim()
  } catch {
    // Not JSON — keep the raw text.
  }
  if (profile && (response.status === 409 || response.status === 404)) {
    return `${PROFILE_REFUSAL_PREFIX}${
      detail || `profile "${profile}" is not available on this gateway.`
    }`
  }
  return detail || `Request failed (${response.status})`
}
