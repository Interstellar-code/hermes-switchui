/**
 * What version of hermes-agent is actually running.
 *
 * The other half of this — parsing and comparing version strings — lives in
 * `agent-version.ts`, and the split is load-bearing. `hermes-slash-policy.ts`
 * applies the version floor with `meetsAgentVersionFloor`, and that file is
 * **also imported by the browser** (`use-slash-commands.ts` reads
 * `SLASH_EXEC_ALLOWLIST` and `INTENTIONALLY_SHADOWED_COMMANDS` from it). This
 * file cannot be in that graph: `gateway-capabilities.ts` kicks off
 * `ensureGatewayProbed()` at module scope, so merely importing it starts a live
 * probe. Keeping the comparator dependency-free is what stops a policy check
 * dragging the whole probe machinery — and `fs`, `path` and `~/.hermes` reads —
 * into the client bundle and into every jsdom hook test.
 *
 * ── Which process's version, and why ──────────────────────────────────────
 * The **dashboard**'s (`${CLAUDE_DASHBOARD_URL}/api/status`), not the
 * gateway's (`/health`). Both are the same hermes-agent install in a normal
 * deployment and report the same string — verified live on 2026-08-13, both
 * `0.19.16` — but they are separate processes and only one of them is
 * relevant to the thing this gates:
 *
 *   • Every allowlisted slash command executes in the dashboard process
 *     (`slash.exec`, `command.dispatch` and `commands.catalog` are all
 *     tui_gateway RPCs over `${CLAUDE_DASHBOARD_URL}/api/ws`).
 *   • Three of the four defects the floor exists to avoid are dashboard-side:
 *     `/compress --preview` really compressing below 0.19.12
 *     (hermes-agent#218), `_get_db()` not being profile-scoped below 0.19.15
 *     (#229), and `commands.catalog` emitting no bundle slugs below 0.19.16.
 *     The fourth — `reasoning_effort` silently ignored by the *gateway* below
 *     0.19.15 — is a composer-picker problem that refusing slash commands
 *     would not fix either way.
 *   • The dashboard must already be reachable for the `agentCommands`
 *     capability to be true at all, so reading its version adds no new way for
 *     the feature to go dark. A gateway-sourced floor would refuse slash
 *     commands whenever the *gateway* was down, which says nothing about
 *     whether they would have worked.
 *
 * ── Cache: short, success-only, invalidatable ─────────────────────────────
 * `routes/api/agent-version.ts` (which this now backs) used to hold its own
 * 60s cache with no invalidation, so a gateway restarted onto a different
 * build stayed misreported for a minute. Tolerable for a version badge, not
 * for a gate:
 *
 *   • **Stale-low is safe** — an agent that was just upgraded is briefly
 *     treated as the older build, so SwitchUI refuses a command that would in
 *     fact have worked. The user retries.
 *   • **Stale-high is not** — an agent that was downgraded or restarted onto
 *     an older build is briefly treated as new enough, and `/compress
 *     --preview` compresses for real.
 *
 * So: a 10s TTL rather than 60s (the read is a ~2ms loopback call; the cache
 * exists only to stop a burst of commands hammering it), a failed or
 * versionless read is **never** cached (a dashboard that is still starting is
 * picked up on the very next call rather than after the TTL — the same
 * discipline as the catalog cache in `hermes-commands.ts`), and
 * `invalidateAgentVersion()`, which `probeGateway()` calls on every re-probe,
 * so a "Reconnect" after an agent restart drops it immediately.
 */

/** How long a successfully-read version is reused. See the header. */
export const AGENT_VERSION_TTL_MS = 10_000

const AGENT_VERSION_TIMEOUT_MS = 3_000

let cached: { version: string; at: number } | null = null
let inflight: Promise<string | null> | null = null

/** Drop the cached version. Called by `probeGateway()` on every re-probe. */
export function invalidateAgentVersion(): void {
  cached = null
  inflight = null
}

/**
 * The running agent's version string, or null when it cannot be established —
 * dashboard unreachable, non-2xx, unparseable body, or a body with no
 * `version`. Null is "unknown", and unknown fails closed at every call site.
 */
export async function getAgentVersion(options?: {
  force?: boolean
}): Promise<string | null> {
  const force = options?.force === true
  const now = Date.now()
  // `now >= cached.at` guards backward clock skew (NTP correction, sleep/wake):
  // without it a negative age passes the TTL test forever.
  if (!force && cached && now >= cached.at && now - cached.at < AGENT_VERSION_TTL_MS) {
    return cached.version
  }
  if (!force && inflight) return inflight

  inflight = (async () => {
    try {
      // Dynamic, and deliberately so even though this module is server-only:
      // `gateway-capabilities` starts a live probe at module scope, so a static
      // import would make importing *anything* from here launch one.
      // `CLAUDE_DASHBOARD_URL` is also a live binding that auto-detection and
      // `setDashboardUrl` can move, so it is read per call rather than captured.
      const { CLAUDE_DASHBOARD_URL } = await import('./gateway-capabilities')
      const res = await fetch(`${CLAUDE_DASHBOARD_URL}/api/status`, {
        signal: AbortSignal.timeout(AGENT_VERSION_TIMEOUT_MS),
      })
      if (!res.ok) return null
      const body = (await res.json().catch(() => null)) as {
        version?: unknown
      } | null
      const version = typeof body?.version === 'string' ? body.version.trim() : ''
      if (!version) return null
      cached = { version, at: Date.now() }
      return version
    } catch {
      // Unreachable dashboard, timeout, or a body that is not JSON. Not
      // cached: the next call retries, so an agent that is still starting is
      // picked up immediately rather than after the TTL.
      return null
    }
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}
