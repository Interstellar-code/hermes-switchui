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
 *  2. When multiplexing is OFF the gateway *silently ignores* a `/p/<profile>/`
 *     prefix (`_resolve_request_profile` returns None) and resolves the raw
 *     session ID against whichever `state.db` it is running on. A 200 is
 *     therefore not proof the prefix was honoured — it can be a silent
 *     cross-profile write. So the check has to happen here, client-side,
 *     before the request leaves, and it can never be inferred from a status
 *     code. Upstream fail-closed is tracked as hermes-agent#202.
 *
 * Everything profile-scoped funnels through `scopedPath()`. Passing no profile
 * returns the path untouched and does not probe — legacy single-profile
 * behaviour stays byte-identical.
 */

import { CLAUDE_API, CLAUDE_DASHBOARD_URL } from './gateway-capabilities'

// ── Topology ──────────────────────────────────────────────────────

export type GatewayMode =
  /** Multiplexing off: the gateway serves exactly one profile (its own) and a
   *  `/p/` prefix would be silently ignored. `activeProfile` is the profile
   *  that process is running — the one an UNPREFIXED request provably reaches.
   *  `null` when the probe could not determine it, in which case every
   *  explicitly-scoped request fails closed. */
  | { mode: 'single'; servedProfiles: null; activeProfile: string | null }
  /** Multiplexing on: authoritative list of profiles the LIVE process serves.
   *  `activeProfile` is meaningless here — a bare URL resolves to `default`,
   *  not to any "active" profile — so it is always `null`. */
  | { mode: 'multiplex'; servedProfiles: Array<string>; activeProfile: null }

/** Fail-closed fallback: unknown topology AND unknown active profile, so
 *  `assertProfileServed` rejects every explicit profile. */
const SINGLE: GatewayMode = {
  mode: 'single',
  servedProfiles: null,
  activeProfile: null,
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
 * payload resolves to `single`, which makes every profile-scoped request throw.
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
    if (!res.ok) return SINGLE
    const body = (await res.json()) as {
      gateway_mode?: string
      gateways?: Array<{ profile?: string; served_profiles?: Array<string> }>
      profiles?: Array<string>
    }
    const entries = body.gateways ?? []
    const isMultiplex =
      body.gateway_mode === 'multiplex' ||
      body.gateway_mode === 'multiple' ||
      entries.some((g) => (g.served_profiles?.length ?? 0) > 1)

    if (!isMultiplex) {
      const active = entries.find((g) => g.profile)?.profile
      return active
        ? { mode: 'single', servedProfiles: null, activeProfile: String(active) }
        : SINGLE
    }

    const served = Array.from(
      new Set([
        ...entries.flatMap((g) => g.served_profiles ?? []),
        ...entries.map((g) => g.profile).filter((p): p is string => Boolean(p)),
      ]),
    )
    return {
      mode: 'multiplex',
      servedProfiles: served.map(String),
      activeProfile: null,
    }
  } catch {
    return SINGLE
  }
}

// ── Typed failures ────────────────────────────────────────────────

/** Gateway is not multiplexing, so the prefix would be silently ignored.
 *  Maps to HTTP 409 at route boundaries. */
export class ProfileScopeUnavailableError extends Error {
  readonly profile: string
  /** The profile the non-multiplexed gateway IS running, when known. */
  readonly activeProfile: string | null
  constructor(profile: string, activeProfile: string | null = null) {
    super(
      activeProfile
        ? `Profile "${profile}" cannot be targeted: this gateway is running the ` +
          `"${activeProfile}" profile and is not multiplexed, so it can only serve ` +
          `"${activeProfile}". Switch to "${activeProfile}", or enable ` +
          'gateway.multiplex_profiles and restart the gateway to reach several profiles at once.'
        : `Profile "${profile}" cannot be targeted: the gateway is not running in multiplex mode ` +
          'and its own profile could not be determined. Enable gateway.multiplex_profiles and ' +
          'restart the gateway, or check that the Hermes dashboard is reachable.',
    )
    this.name = 'ProfileScopeUnavailableError'
    this.profile = profile
    this.activeProfile = activeProfile
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
  | ProfileNotServedError
  | ProfileRequestFailedError {
  return (
    err instanceof ProfileScopeUnavailableError ||
    err instanceof ProfileNotServedError ||
    err instanceof ProfileRequestFailedError
  )
}

/** HTTP status a route boundary should return for a profile scope failure. */
export function profileErrorStatus(err: unknown): number {
  if (err instanceof ProfileScopeUnavailableError) return 409
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
  if (topology.mode !== 'multiplex') {
    // Not multiplexed. The only profile reachable at all is the one this
    // gateway process is running, and it is reachable UNPREFIXED — a prefix
    // would be silently ignored (upstream returns 200 without honouring it),
    // so the bare URL is the correct and provable way to address it.
    if (topology.activeProfile && profile === topology.activeProfile) {
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
