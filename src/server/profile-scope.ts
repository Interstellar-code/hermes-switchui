/**
 * Profile scoping for the Hermes gateway's `/p/<profile>/` multiplex prefix.
 *
 * A multiplexing gateway (`gateway.multiplex_profiles`) serves every profile
 * from one process and routes by URL prefix. Two rules make this dangerous
 * enough to need a single chokepoint:
 *
 *  1. An UNPREFIXED request means "the gateway's active profile" when
 *     multiplexing is off, but "**default**" when it is on. The meaning of a
 *     bare URL is topology-dependent, so under MULTIPLEX an explicitly chosen
 *     profile is ALWAYS prefixed — including `default`, and including the
 *     profile that happens to be the multiplexer's own. There is no "omit the
 *     prefix because it resolves the same" shortcut *under multiplex*.
 *
 *     The one case where an explicit profile is correctly served UNPREFIXED is
 *     multiplexing OFF and the requested profile being the very profile the
 *     gateway process is running. There, a bare URL provably resolves to that
 *     profile's `state.db` — it is not a guess, and refusing it would reject
 *     the single most common request in a non-multiplexed install: "show me
 *     the profile I am already on". Note this is NOT the rejected rev-1 rule
 *     ("omit whenever profile === active"), which was unsafe precisely because
 *     it also omitted under multiplex, where bare means `default`.
 *  2. Until recently, when multiplexing was OFF the gateway *silently
 *     ignored* a `/p/<profile>/` prefix (`_resolve_request_profile` returned
 *     `None`) and resolved the raw session ID against whichever `state.db`
 *     it was running on. A 200 was therefore not proof the prefix had been
 *     honoured — it could be a silent cross-profile write. That was tracked
 *     as hermes-agent#202.
 *
 *     Upstream has since fixed it (superseding #202): `_resolve_request_profile`
 *     now returns a `_PROFILE_REJECTED` sentinel whenever a `/p/<profile>/`
 *     prefix is present and multiplexing is off (or the profile is unknown),
 *     and the adapter maps that sentinel to an explicit
 *     `404 {"error": "Unknown or unconfigured profile"}` instead of falling
 *     through — see `gateway/platforms/api_server.py`'s
 *     `_resolve_request_profile` / `_make_profile_prefix_middleware` and the
 *     mirrored `gateway/platforms/webhook.py`, both exercised by
 *     `tests/gateway/test_multiplex_api_server_routing.py`
 *     (`test_prefix_rejected_when_multiplex_off`). Verified present in the
 *     currently-installed gateway: hermes-agent 0.19.9, commit 86480a4c.
 *
 *     That fix does NOT retire this client-side chokepoint. Two hazards
 *     survive it, and both are called out by the gateway's own code:
 *       - Version skew: this workspace can be pointed at any gateway build,
 *         including ones that predate the fix and still silently 200. Nothing
 *         observable at request time proves which behaviour a given gateway
 *         has, so we cannot conditionally relax the guard.
 *       - TOCTOU: `_resolve_request_profile`'s own comment spells it out —
 *         "/api/status gateway_mode is a cache, and the gateway can restart
 *         with multiplexing off between the check and the send." Our own
 *         topology read below (`getGatewayMode()`, `MODE_TTL_MS`) has exactly
 *         that same window; a cache can't close a race against the thing it
 *         caches.
 *     So the guard stays: it turns either hazard into one clean, typed
 *     pre-flight error instead of leaning on every call site to treat a bare
 *     404 as "profile rejected" (indistinguishable from an ordinary
 *     resource-not-found), and it is the only place that can fail closed
 *     before a fully-patched gateway even gets asked.
 *
 * Everything profile-scoped funnels through `scopedPath()`. Passing no profile
 * returns the path untouched and does not probe — legacy single-profile
 * behaviour stays byte-identical.
 */

import { CLAUDE_API, CLAUDE_DASHBOARD_URL } from './gateway-capabilities'

// ── Topology ──────────────────────────────────────────────────────

export type GatewayMode =
  /** Multiplexing off: the gateway serves exactly one profile (its own) and a
   *  `/p/` prefix would be rejected (or, on an unpatched gateway, silently
   *  ignored — see the header). `activeProfile` is the profile that process
   *  is running — the one an UNPREFIXED request provably reaches. This
   *  variant always carries a real profile name; when the probe can't
   *  determine one, the result is `'unknown'` below instead of `activeProfile:
   *  null` — there is no ambiguous half-known `single`. */
  | { mode: 'single'; servedProfiles: null; activeProfile: string }
  /** Multiplexing on: authoritative list of profiles the LIVE process serves.
   *  `activeProfile` is meaningless here — a bare URL resolves to `default`,
   *  not to any "active" profile — so it is always `null`. */
  | { mode: 'multiplex'; servedProfiles: Array<string>; activeProfile: null }
  /** Topology could not be established well enough to authorise (or refuse)
   *  a specific profile — distinct from `single` (topology IS known: not
   *  multiplexed) and from `multiplex` with an empty roster (topology IS
   *  known: multiplexed, nothing served). Conflating "I don't know" with
   *  "I know the answer is no" is exactly what made a remote/gated client
   *  blame multiplex configuration for something a loopback client would
   *  never see (audit item 3) — so `assertProfileServed` throws a distinct
   *  `ProfileScopeIndeterminateError` for this variant rather than falling
   *  into the `single` branch's "not multiplexed" message. */
  | {
      mode: 'unknown'
      servedProfiles: null
      activeProfile: null
      /** `'remote-gated'`: the dashboard answered and `gateway_mode` came
       *  through (it survives the loopback gate as low-sensitivity PRODUCT
       *  surface — see `hermes_cli/web_server.py`'s `/api/status` handler),
       *  but the `gateways[]` / `hermes_home` detail every other variant is
       *  built from was withheld because this client isn't loopback. The
       *  remedy is "ask from a loopback client" or "this cannot be verified
       *  remotely" — NOT "enable multiplex_profiles", which may already be
       *  on.
       *  `'probe-failed'`: the dashboard was unreachable, errored, timed
       *  out, or answered with a shape we don't recognise. The remedy here
       *  genuinely is local: check the dashboard is running, or that
       *  multiplex_profiles + a restart is what's needed. */
      reason: 'remote-gated' | 'probe-failed'
    }

/** Fail-closed fallback for a probe that couldn't be completed at all
 *  (unreachable dashboard, network error, timeout, unrecognised payload) —
 *  as opposed to one that completed and reported a gated/remote topology.
 *  `assertProfileServed` rejects every explicit profile for both `'unknown'`
 *  reasons, but with a message that matches which one actually happened. */
const PROBE_FAILED: GatewayMode = {
  mode: 'unknown',
  servedProfiles: null,
  activeProfile: null,
  reason: 'probe-failed',
}

/** Fail-closed fallback for a probe that completed but was answered from
 *  outside the loopback trust envelope, so the detail needed to tell `single`
 *  from `multiplex` (or to name an active/served profile) was withheld. */
const REMOTE_GATED: GatewayMode = {
  mode: 'unknown',
  servedProfiles: null,
  activeProfile: null,
  reason: 'remote-gated',
}

/** Short TTL, not a permanent cache: multiplexing can be turned off by a
 *  gateway restart at any time (§1.3-C). A fresh-ish probe narrows that race;
 *  it cannot close it, which is why the operator invariant is "hold multiplex
 *  enabled while cross-profile work is in flight". */
const MODE_TTL_MS = 5_000
const PROBE_TIMEOUT_MS = 3_000

// The cache is keyed by BOTH URLs it describes: the dashboard URL it was
// probed against AND the gateway URL the answer authorises writes to. Keying
// on the dashboard alone made a gateway repoint (setGatewayUrl, or the
// 8642/8643/8645 port autodetect at gateway-capabilities.ts:917) reuse the
// previous gateway's topology for up to the TTL — i.e. a scoped write sent to
// a different process under a mode that process never reported. Keying on the
// pair invalidates by construction, with no import cycle back into
// gateway-capabilities just to reset a variable.
function modeCacheKey(): string {
  return [CLAUDE_DASHBOARD_URL, CLAUDE_API].join(' -> ')
}

let cached: { at: number; url: string; value: GatewayMode } | null = null
// Keyed the same way: an in-flight probe started against the old URLs must not
// be handed to a caller asking after a repoint.
let inflight: { url: string; promise: Promise<GatewayMode> } | null = null

/** Drop the cached topology. Call after anything that can repoint or restart
 *  the gateway (connection-settings URL change, manual reprobe). */
export function invalidateGatewayMode(): void {
  cached = null
  inflight = null
}

/**
 * Probed gateway topology — never a config read. `gateway.multiplex_profiles`
 * being true in config.yaml does not prove the RUNNING process was started
 * with it, so we ask the dashboard, which derives `gateway_mode` and
 * `served_profiles` from the live gateway's runtime state file.
 *
 * Fails closed: any probe error, unreachable dashboard, or unrecognised
 * payload resolves to `'unknown'` (reason `'probe-failed'`), and a dashboard
 * that answered but withheld gated detail resolves to `'unknown'` (reason
 * `'remote-gated'`) — both make every profile-scoped request throw, just with
 * a message that matches which one actually happened.
 */
export async function getGatewayMode(
  opts: { force?: boolean } = {},
): Promise<GatewayMode> {
  const key = modeCacheKey()
  const dashboardUrl = CLAUDE_DASHBOARD_URL
  if (!opts.force) {
    if (cached && cached.url === key && Date.now() - cached.at < MODE_TTL_MS) {
      return cached.value
    }
    if (inflight && inflight.url === key) return inflight.promise
  }
  const run = probeMode(dashboardUrl).then((value) => {
    cached = { at: Date.now(), url: key, value }
    return value
  })
  const entry = { url: key, promise: run }
  entry.promise = run.finally(() => {
    if (inflight === entry) inflight = null
  })
  inflight = entry
  return entry.promise
}

async function probeMode(dashboardUrl: string): Promise<GatewayMode> {
  try {
    const res = await fetch(`${dashboardUrl}/api/status`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!res.ok) return PROBE_FAILED
    const body = (await res.json()) as {
      gateway_mode?: string
      hermes_home?: string
      auth_required?: boolean
      gateways?: Array<{ profile?: string; served_profiles?: Array<string> }>
      profiles?: Array<string>
    }
    const entries = body.gateways ?? []
    const isMultiplex =
      body.gateway_mode === 'multiplex' ||
      entries.some((g) => (g.served_profiles?.length ?? 0) > 1)

    // `auth_required` survives the loopback gate on every `/api/status` reply
    // (hermes_cli/web_server.py's "always-public liveness" block — see the
    // header). `true` means this dashboard is on a gated/non-loopback bind,
    // so `gateways[]` and `hermes_home` — the ONLY fields `entries` and
    // `homeProfile` below are built from — were withheld. An empty `entries`
    // here does not mean "nothing is being served"; it means "we asked from
    // outside the trust envelope and got the public shape only".
    const remoteGated = body.auth_required === true

    // "multiple" (hermes_cli/web_server.py's `_collect_profile_gateway_topology`)
    // means several INDEPENDENT single-profile gateway processes — not one
    // multiplexer, and none of them understands `/p/<profile>/`. Worse, this
    // payload carries no port info tying any one `entries[]` item to the
    // specific CLAUDE_API host this workspace actually talks to, so guessing
    // "the first entry with a profile" (the single-mode fallback below) could
    // attribute CLAUDE_API's answers to the WRONG one of several live
    // profiles — exactly the wrong-profile write this module exists to
    // prevent. Fail closed instead of guessing.
    if (!isMultiplex && body.gateway_mode === 'multiple') {
      return remoteGated ? REMOTE_GATED : PROBE_FAILED
    }

    const homeProfile = body.hermes_home
      ? body.hermes_home.includes('/profiles/')
        ? body.hermes_home.split('/profiles/').pop()?.split('/')[0] || null
        : 'default'
      : null
    const active = entries.find((g) => g.profile)?.profile || homeProfile

    if (!isMultiplex) {
      if (active) {
        return { mode: 'single', servedProfiles: null, activeProfile: String(active) }
      }
      return remoteGated ? REMOTE_GATED : PROBE_FAILED
    }

    const served = Array.from(
      new Set([
        ...entries.flatMap((g) => g.served_profiles ?? []),
        ...entries.map((g) => g.profile).filter((p): p is string => Boolean(p)),
      ]),
    )
    if (served.length === 0 && remoteGated) {
      // `gateway_mode: 'multiplex'` survived the gate (low-sensitivity), but
      // the roster it's built from (`gateways[]`) did not. We KNOW
      // multiplexing is on; we just can't confirm which profiles are served
      // from here. That is a different fact — and a different remedy — than
      // "not served" (404), so don't manufacture an empty roster and let
      // every profile fail as though the gateway itself had said so.
      return REMOTE_GATED
    }
    return {
      mode: 'multiplex',
      servedProfiles: served.map(String),
      activeProfile: null,
    }
  } catch {
    return PROBE_FAILED
  }
}

// ── Typed failures ────────────────────────────────────────────────

/** Gateway is not multiplexing, so the prefix would be rejected (or, on an
 *  unpatched gateway, silently ignored — see the header). Maps to HTTP 409 at
 *  route boundaries. Only thrown when the gateway's own profile IS known —
 *  see `ProfileScopeIndeterminateError` for "we don't even know that". */
export class ProfileScopeUnavailableError extends Error {
  readonly profile: string
  /** The profile the non-multiplexed gateway IS running. */
  readonly activeProfile: string
  constructor(profile: string, activeProfile: string) {
    super(
      `Profile "${profile}" cannot be targeted: this gateway is running the ` +
        `"${activeProfile}" profile and is not multiplexed, so it can only serve ` +
        `"${activeProfile}". Switch to "${activeProfile}", or enable ` +
        'gateway.multiplex_profiles and restart the gateway to reach several profiles at once.',
    )
    this.name = 'ProfileScopeUnavailableError'
    this.profile = profile
    this.activeProfile = activeProfile
  }
}

/** Topology could not be established well enough to authorise (or refuse) a
 *  specific profile — the `'unknown'` `GatewayMode` variant. Distinct from
 *  `ProfileScopeUnavailableError` (topology IS known: not multiplexed) and
 *  `ProfileNotServedError` (topology IS known: multiplexed, this profile
 *  isn't in it). Telling a remote/gated caller to "enable multiplex_profiles"
 *  when we simply couldn't see the roster from here blames the wrong thing —
 *  see audit item 3 / the `GatewayMode` doc. Maps to HTTP 409 at route
 *  boundaries, same status class as "not multiplexed" (both mean "cannot do
 *  this right now"), but a caller that wants to branch on why can via
 *  `.reason`. */
export class ProfileScopeIndeterminateError extends Error {
  readonly profile: string
  readonly reason: 'remote-gated' | 'probe-failed'
  constructor(profile: string, reason: 'remote-gated' | 'probe-failed') {
    super(
      reason === 'remote-gated'
        ? `Profile "${profile}" cannot be verified from here: this workspace is talking to a ` +
          'gated (non-loopback) Hermes dashboard, which withholds gateway topology detail from ' +
          'remote clients for security. This is NOT necessarily a multiplex configuration ' +
          'problem — the gateway may already be multiplexed and serving this profile — but a ' +
          'remote client cannot confirm it, so the request is refused rather than guessed at.'
        : `Profile "${profile}" cannot be targeted: the gateway topology probe failed (the ` +
          'Hermes dashboard was unreachable, timed out, or returned something unexpected). ' +
          'Check that the dashboard is running and reachable, then try again.',
    )
    this.name = 'ProfileScopeIndeterminateError'
    this.profile = profile
    this.reason = reason
  }
}

/** Multiplexing is on but this gateway does not serve that profile.
 *  Maps to HTTP 404 at route boundaries. */
export class ProfileNotServedError extends Error {
  readonly profile: string
  readonly servedProfiles: Array<string>
  constructor(profile: string, servedProfiles: Array<string>) {
    super(
      `Profile "${profile}" is not served by this gateway (serving: ${
        servedProfiles.length ? servedProfiles.join(', ') : 'none'
      }).`,
    )
    this.name = 'ProfileNotServedError'
    this.profile = profile
    this.servedProfiles = servedProfiles
  }
}

/** A prefixed request reached the gateway and came back 4xx. Kept typed so a
 *  caller can surface it instead of retrying the same call unprefixed — an
 *  unprefixed retry is exactly the silent cross-profile write we're avoiding. */
export class ProfileRequestFailedError extends Error {
  readonly profile: string
  readonly status: number
  constructor(profile: string, status: number, detail = '') {
    super(
      `Profile "${profile}" request failed: ${status}${detail ? ` ${detail}` : ''}`,
    )
    this.name = 'ProfileRequestFailedError'
    this.profile = profile
    this.status = status
  }
}

export function isProfileScopeError(
  err: unknown,
): err is
  | ProfileScopeUnavailableError
  | ProfileScopeIndeterminateError
  | ProfileNotServedError
  | ProfileRequestFailedError {
  return (
    err instanceof ProfileScopeUnavailableError ||
    err instanceof ProfileScopeIndeterminateError ||
    err instanceof ProfileNotServedError ||
    err instanceof ProfileRequestFailedError
  )
}

/** HTTP status a route boundary should return for a profile scope failure. */
export function profileErrorStatus(err: unknown): number {
  if (err instanceof ProfileScopeUnavailableError) return 409
  if (err instanceof ProfileScopeIndeterminateError) return 409
  if (err instanceof ProfileNotServedError) return 404
  if (err instanceof ProfileRequestFailedError) return err.status
  return 500
}

// ── Prefixing ─────────────────────────────────────────────────────

/**
 * The single construction point for `/p/<profile>` segments — no caller builds
 * one by hand. No special case for `default`, none for the active profile.
 */
export function profilePath(path: string, profile: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`profilePath: path must start with '/' (got ${path})`)
  }
  return `/p/${encodeURIComponent(profile)}${path}`
}

/** Throws unless the live gateway is multiplexing AND serves `profile`. */
export async function assertProfileServed(
  profile: string,
): Promise<GatewayMode> {
  const topology = await getGatewayMode()
  if (topology.mode === 'unknown') {
    // Topology genuinely could not be established — not "known to be single"
    // and not "known to be multiplex with an empty roster". Say so, with the
    // right remedy for why (see `ProfileScopeIndeterminateError`), instead of
    // falling into the `single` branch below and blaming multiplex config.
    throw new ProfileScopeIndeterminateError(profile, topology.reason)
  }
  if (topology.mode !== 'multiplex') {
    // Not multiplexed. The only profile reachable at all is the one this
    // gateway process is running, and it is reachable UNPREFIXED — a prefix
    // would be rejected (or, on an unpatched gateway, silently ignored — see
    // the header), so the bare URL is the correct and provable way to
    // address it.
    if (profile === topology.activeProfile) {
      return topology
    }
    throw new ProfileScopeUnavailableError(profile, topology.activeProfile)
  }
  if (!topology.servedProfiles.includes(profile)) {
    throw new ProfileNotServedError(profile, topology.servedProfiles)
  }
  return topology
}

/**
 * Prefix `path` for an explicitly selected profile, failing closed first.
 * A falsy profile means "no profile intent" — the path is returned untouched
 * and nothing is probed, so unscoped callers behave exactly as before.
 */
export async function scopedPath(
  path: string,
  profile?: string | null,
): Promise<string> {
  if (!profile) return path
  const topology = await assertProfileServed(profile)
  // Non-multiplexed and the profile matched the gateway's own: the bare path
  // already resolves there. Prefixing would be silently ignored upstream, so
  // it would add risk (a 200 that proves nothing) without adding scoping.
  if (topology.mode !== 'multiplex') return path
  return profilePath(path, profile)
}

/** Normalize a profile value off a request body/query. Empty/absent → null
 *  (unscoped). Keeps every route boundary agreeing on what "no profile" is. */
export function readProfile(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Convert a non-OK response to a prefixed request into a typed error, so it
 *  can't be mistaken for a generic upstream failure and retried unprefixed. */
export async function assertProfileResponseOk(
  res: Response,
  profile: string | null | undefined,
): Promise<void> {
  if (res.ok || !profile) return
  if (res.status !== 404 && res.status !== 401 && res.status !== 403) return
  const detail = (await res.text().catch(() => '')).slice(0, 500)
  throw new ProfileRequestFailedError(profile, res.status, detail)
}
