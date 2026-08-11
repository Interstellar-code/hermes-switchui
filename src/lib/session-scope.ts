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
 * The persisted encoding of "no profile selected".
 *
 * A stored preference cannot use `null`/`''` and stay readable in localStorage
 * across store versions, so the sidebar has always persisted the sentinel
 * `'active'` ("whatever profile the gateway is currently running"). It is NOT a
 * profile name and must never reach a URL, a query key, or a request body.
 *
 * The hazard this constant exists to make visible: `'default'` **is** a real
 * profile under a multiplex gateway (`/p/default/health` → 200), so "unscoped"
 * and "the profile literally named default" are different states. Only the
 * sentinel collapses to unscoped; `'default'` never does.
 *
 * Kept in lockstep with `ACTIVE_PROFILE` in `screens/chat/sessions-feed.ts`
 * (pinned by a test) — that module owns the list-filter half of the same value.
 */
export const UNSCOPED_PROFILE = 'active'

/**
 * Normalize a *persisted* profile preference. Same as {@link normalizeProfile}
 * but additionally collapses the `'active'` sentinel to `null`.
 */
export function normalizeStoredProfile(value: unknown): string | null {
  const normalized = normalizeProfile(value)
  return normalized === UNSCOPED_PROFILE ? null : normalized
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
// THE single source of truth for "which profile is this tab working in".
// Everything that builds a session-derived key — query keys, chat-store map
// keys, sessionStorage slots — and every client write body reads it from here
// rather than taking a `profile` parameter.
//
// Why ambient and not a prop/context: the key builders are the enforcement
// point. If profile were a parameter, a future key could simply omit it and
// silently go bare — the exact bug this module exists to kill. Reading it here
// means a bare key is not expressible.
//
// There are exactly TWO ranked inputs and ONE resolved answer:
//
//   1. `url`    — `?profile=` on `/chat/$sessionKey`, applied by the route in
//                 `beforeLoad` (i.e. before the subtree renders). Per tab, and
//                 per link: a sidebar row for another profile's session carries
//                 it, so the tab it opens is pinned to that session's home.
//   2. `device` — the sidebar profile dropdown's persisted selection
//                 (`hermes.sessions.filter`). Says "the profile I am working
//                 in on this device"; applies to anything the URL has not
//                 already pinned, which is what makes a *new* chat started
//                 after picking `hermes-switch` actually send to
//                 `hermes-switch`.
//
//   resolved = url ?? (device, while the route allows it) ?? null
//
// The device layer is deliberately NOT a mirror of the URL (see the rule in
// `stores/profiles-screen-store.ts`: "a mirror would be a second writable copy,
// and the two can disagree"). Nothing copies one into the other; they are two
// differently-scoped inputs with a total precedence order, so there is no state
// in which they can disagree about the answer — only about who supplied it.
//
// ponytail: one profile per tab. Rendering two profiles side by side would need
// a real context; add it when a surface actually shows two at once.

/** Which input supplied the resolved profile. `'none'` = unscoped. */
export type ProfileSource = 'url' | 'device' | 'none'

/** The resolved answer plus its provenance. Provenance matters to the UI: a
 *  picker whose write would lose to a higher-ranked input must not pretend it
 *  can win. */
export type ProfileScope = { profile: string | null; source: ProfileSource }

/** Frozen so the "unscoped" snapshot is referentially stable for
 *  `useSyncExternalStore`, on both the server and the client. */
const UNSCOPED_SCOPE: ProfileScope = Object.freeze({
  profile: null,
  source: 'none',
})

let urlProfile: string | null = null
let deviceProfile: string | null = null
/** Path allowlist gate for the device layer — see `syncSessionProfileToPath`. */
let deviceProfileAllowed = false

let scopeSnapshot: ProfileScope = UNSCOPED_SCOPE
const scopeListeners = new Set<() => void>()

/**
 * The resolver — `url ?? device ?? null` — as a pure function.
 *
 * Exported so precedence is testable without touching module state, and so the
 * ONE place the rule is written is the same one the module itself runs.
 *
 * `storedProfile` is the raw persisted value, sentinel included: collapsing
 * `'active'` here (rather than at each call site) is what keeps "unscoped" and
 * "the profile literally named `default`" from ever being conflated.
 */
export function resolveProfile(input: {
  urlProfile?: unknown
  storedProfile?: unknown
  /** False on a route where a device-level profile must not apply. */
  allowStored?: boolean
}): ProfileScope {
  const fromUrl = normalizeProfile(input.urlProfile)
  if (fromUrl) return { profile: fromUrl, source: 'url' }
  if (input.allowStored === false) return UNSCOPED_SCOPE
  const fromStore = normalizeStoredProfile(input.storedProfile)
  if (fromStore) return { profile: fromStore, source: 'device' }
  return UNSCOPED_SCOPE
}

/** Recompute the snapshot; notify only when the answer actually moved. */
function publishScope(): boolean {
  const next = resolveProfile({
    urlProfile,
    storedProfile: deviceProfile,
    allowStored: deviceProfileAllowed,
  })
  if (
    next.profile === scopeSnapshot.profile &&
    next.source === scopeSnapshot.source
  ) {
    return false
  }
  scopeSnapshot = next
  for (const listener of scopeListeners) listener()
  return true
}

/**
 * Set the URL layer (`?profile=`). Returns true when that layer changed.
 *
 * No-op on the server: module state there is shared across every request, so a
 * write would leak one user's profile into another's render. Every consumer
 * (query cache, chat-store, sessionStorage) is client-only anyway.
 */
export function setSessionProfile(profile: unknown): boolean {
  if (typeof window === 'undefined') return false
  const next = normalizeProfile(profile)
  if (next === urlProfile) return false
  urlProfile = next
  publishScope()
  return true
}

/**
 * Set the device layer — the sidebar dropdown's persisted selection. Accepts
 * the raw stored value, sentinel included. Returns true when the *resolved*
 * scope changed (it does not, when a URL profile outranks it).
 *
 * Single writer: `stores/sessions-filter-store.ts`, which subscribes its own
 * `profile` field to this. No component calls it directly.
 */
export function setDeviceSessionProfile(profile: unknown): boolean {
  if (typeof window === 'undefined') return false
  const next = normalizeStoredProfile(profile)
  if (next === deviceProfile) return false
  deviceProfile = next
  return publishScope()
}

/** The resolved profile. `null` = unscoped (NOT "the profile named default"). */
export function getSessionProfile(): string | null {
  return scopeSnapshot.profile
}

/** The resolved profile plus which layer supplied it. */
export function getSessionProfileScope(): ProfileScope {
  return scopeSnapshot
}

/**
 * Server snapshot for `useSyncExternalStore`. Always unscoped, always the same
 * object: SSR and the first client render must agree, and must never guess a
 * concrete profile name that the persisted store might contradict a moment
 * later.
 */
export function getServerSessionProfileScope(): ProfileScope {
  return UNSCOPED_SCOPE
}

/**
 * Resolve against a caller-supplied URL value instead of this module's own
 * `urlProfile` slot, reusing the device layer as-is.
 *
 * For components that already hold a render-synced `?profile=` (a router
 * `useSearch()` result). The module's slot is written by
 * `/chat/$sessionKey`'s `beforeLoad`, so a component rendering outside that
 * route — or ahead of it in a test — can legitimately hold a fresher URL
 * value than the singleton. Such a component must NOT restate `url ??
 * device`: that is the rule, it lives in `resolveProfile`, and a second copy
 * is a second thing to keep correct. This is the seam that lets a caller
 * substitute the input without also inheriting the precedence logic.
 */
let urlOverrideCache: {
  urlOverride: unknown
  deviceProfile: string | null
  allowStored: boolean
  scope: ProfileScope
} | null = null

export function resolveSessionProfileScopeForUrl(
  urlOverride: unknown,
): ProfileScope {
  // MUST return a referentially stable object for unchanged inputs.
  // `useSyncExternalStore` compares snapshots by identity, and `resolveProfile`
  // builds a fresh `{profile, source}` every call — returning that directly
  // makes every render look like a change and spins React forever (it does not
  // warn, it hangs). So memoize on the exact inputs the answer depends on.
  const cached = urlOverrideCache
  if (
    cached &&
    cached.urlOverride === urlOverride &&
    cached.deviceProfile === deviceProfile &&
    cached.allowStored === deviceProfileAllowed
  ) {
    return cached.scope
  }
  // `urlOverride`, NOT the module's own `urlProfile` slot — substituting that
  // input is the entire point of this function. The two names differed only by
  // shadowing until eslint's no-shadow flagged it; the rename is what keeps a
  // future edit from silently rebinding to the module variable.
  const scope = resolveProfile({
    urlProfile: urlOverride,
    storedProfile: deviceProfile,
    allowStored: deviceProfileAllowed,
  })
  urlOverrideCache = {
    urlOverride,
    deviceProfile,
    allowStored: deviceProfileAllowed,
    scope,
  }
  return scope
}

export function subscribeSessionProfileScope(listener: () => void): () => void {
  scopeListeners.add(listener)
  return () => {
    scopeListeners.delete(listener)
  }
}

/**
 * Every route whose subtree may legitimately hold a scoped profile.
 *
 * An explicit allowlist, not a heuristic: a route earns a place here only once
 * its surfaces are known to build every session key and every write body from
 * the ambient profile. Today that is exactly the chat surface, which is what
 * this guard has always allowed.
 */
const PROFILE_SCOPED_PATH_PREFIXES: ReadonlyArray<string> = ['/chat']

export function isProfileScopedPath(pathname: string): boolean {
  return PROFILE_SCOPED_PATH_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  )
}

/**
 * Drop the ambient profile once the app is no longer on the chat surface.
 *
 * Only `/chat/$sessionKey` ever sets the URL layer, but module state outlives
 * the route: without this, leaving a scoped chat for `/dashboard` leaves `neo`
 * ambient, and the floating chat panel — which renders on those routes with no
 * `?profile=` — would write into `neo` while showing the unscoped session.
 *
 * The device layer is gated by the same allowlist and for the same reason: a
 * persisted sidebar selection must not silently scope a surface that was never
 * audited for it. Off the allowlist the resolver returns `null`, which is
 * byte-identical to the pre-profile behaviour.
 *
 * Deliberately derived from the *resolved* pathname rather than from a leave
 * hook. An unmount/`onLeave` clear races the next route's `beforeLoad`: chat →
 * chat navigation (session-to-session, and the new-chat → real-session swap)
 * would set the profile and then have the outgoing match blank it. A pathname
 * check has no ordering to get wrong — during in-chat navigation the path never
 * stops being `/chat`, so there is no moment at which it clears.
 */
export function syncSessionProfileToPath(pathname: string): void {
  // Server: `__root` renders during SSR too, and module state there is shared
  // across requests. Flipping the gate would leak one request's route into
  // another's render. Client-only, exactly like the setters it calls.
  if (typeof window === 'undefined') return
  const scoped = isProfileScopedPath(pathname)
  if (!scoped) setSessionProfile(null)
  if (deviceProfileAllowed !== scoped) {
    deviceProfileAllowed = scoped
    publishScope()
  }
}

/** Composite key for the ambient profile — the form nearly every caller wants. */
export function activeScopeKey(sessionId: string): string {
  return scopeKey(scopeSnapshot.profile, sessionId)
}

/** Scope segments for the ambient profile. */
export function activeScopeSegments(): Array<string> {
  return scopeSegments(scopeSnapshot.profile)
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
  const profile = scopeSnapshot.profile
  return profile ? { profile } : {}
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
  profile: string | null = scopeSnapshot.profile,
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
