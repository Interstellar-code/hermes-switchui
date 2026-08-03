/**
 * Workspace connection settings — read/write the gateway + dashboard URLs the
 * workspace uses. Writes to the switchui project .env (single source of truth)
 * and updates the in-process CLAUDE_API / CLAUDE_DASHBOARD_URL live, so users
 * can relocate to a Tailscale/LAN address without restarting the workspace.
 * The .env write ensures the URL survives a restart.
 *
 * See #101.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  ensureGatewayProbed,
  getResolvedUrls,
  setDashboardUrl,
  setGatewayUrl,
} from '../../server/gateway-capabilities'
import { requireJsonContentType } from '../../server/rate-limit'
import { invalidateGatewayMode } from '../../server/profile-scope'

/**
 * RFC-1918 / link-local / cloud-metadata IP ranges that must not be accepted
 * as gateway/dashboard destinations (SSRF protection).
 *
 * Loopback (127.x, ::1) and localhost are explicitly ALLOWED because the
 * default Hermes setup runs on 127.0.0.1:8642.
 *
 * Operators can extend allowed hosts via ALLOWED_GATEWAY_HOSTS (comma-sep
 * hostnames/IPs). Example: `ALLOWED_GATEWAY_HOSTS=my-internal-host.local`.
 */
const EXTRA_ALLOWED_HOSTS: Set<string> = new Set(
  (process.env.ALLOWED_GATEWAY_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
)

const PRIVATE_IPV4_RE =
  /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)$/

/** Return true if hostname is a private/link-local IPv4 range (excluding loopback). */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  // Explicitly allow loopback and localhost — these are the default gateway locations.
  // The entire 127.0.0.0/8 range is loopback per RFC 5735, not just 127.0.0.1.
  if (h === 'localhost' || h === '::1') return false
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return false
  // Allow operator-added hosts.
  if (EXTRA_ALLOWED_HOSTS.has(h)) return false
  // Block RFC-1918, link-local, CGNAT.
  if (PRIVATE_IPV4_RE.test(h)) return true
  // Block other private IPv6 (fc00::/7, fe80::/10).
  if (/^fe[89ab][0-9a-f]:/i.test(h) || /^fc[0-9a-f]{2}:/i.test(h)) return true
  return false
}

/**
 * NOTE — lexical validation only: this function checks the URL hostname
 * against known private/loopback ranges using string pattern matching.
 * It does NOT perform DNS resolution, so it does NOT defend against
 * DNS rebinding attacks (where an allowed public hostname later resolves
 * to a private IP at request time).
 *
 * SSRF P2 follow-up: if this workspace is deployed remotely, add an async
 * DNS resolution step here (e.g. dns.promises.lookup) and re-check the
 * resolved IP against PRIVATE_IPV4_RE / isPrivateHost before proceeding.
 */
function isValidHttpUrl(u: string): { ok: true } | { ok: false; reason: string } {
  try {
    const parsed = new URL(u)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: 'Only http and https schemes are allowed' }
    }
    if (isPrivateHost(parsed.hostname)) {
      return {
        ok: false,
        reason: `Host "${parsed.hostname}" resolves to a private/internal range and is not permitted. Set ALLOWED_GATEWAY_HOSTS to allow it explicitly.`,
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'Invalid URL' }
  }
}

export const Route = createFileRoute('/api/connection-settings')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        return Response.json(getResolvedUrls())
      },
      PUT: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json().catch(() => ({}))) as {
            gateway?: unknown
            dashboard?: unknown
          }
          if (body.gateway !== undefined) {
            const value = typeof body.gateway === 'string' ? body.gateway : ''
            if (value) {
              const check = isValidHttpUrl(value)
              if (!check.ok) {
                return Response.json({ error: check.reason }, { status: 400 })
              }
            }
            setGatewayUrl(value)
          }
          if (body.dashboard !== undefined) {
            const value =
              typeof body.dashboard === 'string' ? body.dashboard : ''
            if (value) {
              const check = isValidHttpUrl(value)
              if (!check.ok) {
                return Response.json({ error: check.reason }, { status: 400 })
              }
            }
            setDashboardUrl(value)
          }
          // Repointing either URL means the cached profile-multiplex topology
          // describes a process we are no longer talking to. Drop it now
          // rather than letting the 5s TTL expire: for that window a scoped
          // write would be authorised by the OLD gateway's mode and sent to
          // the NEW one, and a `/p/` prefix a non-multiplexing gateway ignores
          // returns 200 while landing in its own state.db. Same call
          // gateway-reprobe.ts:34 makes for the same reason.
          invalidateGatewayMode()
          // Reprobe so the UI can immediately reflect the new state.
          await ensureGatewayProbed()
          return Response.json({ ok: true, ...getResolvedUrls() })
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to update connection settings'
          return Response.json({ error: message }, { status: 500 })
        }
      },
    },
  },
})
