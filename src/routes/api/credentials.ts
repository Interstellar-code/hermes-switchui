/**
 * /api/credentials — provenance for every provider credential, and the only
 * endpoint that writes one.
 *
 * `GET /api/claude-config` used to answer "is this provider configured?" with
 * a boolean derived from a `.env` parse and a lookup in a file that does not
 * exist. This route answers the question the user actually has: *which* store
 * will the gateway read, is there a second copy that beats it, and — when we
 * genuinely cannot tell — it says so instead of guessing "no".
 *
 * Writes go through `saveCredential`/`removeCredential`, which delegate to the
 * dashboard's reconciling `/api/env` endpoints. See `credential-status.ts` for
 * why there must be exactly one write path.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { validateProviderCredential } from '../../server/claude-dashboard-api'
import {
  collectCredentialStatuses,
  removeCredential,
  saveCredential,
} from '../../server/credential-status'
import { getGatewayMode } from '../../server/profile-scope'
import type { CredentialScope } from '../../server/credential-status'

type AuthResult = Response | true

/** `profile=<name>` on the query string, or the root scope. */
function scopeFromRequest(request: Request): CredentialScope {
  const raw = new URL(request.url).searchParams.get('profile')?.trim() ?? ''
  // Same charset the profiles routes accept; anything else is a path-traversal
  // attempt against `homeForScope`, which joins this into a filesystem path.
  const scope: CredentialScope =
    raw && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(raw) ? `profile:${raw}` : 'root'
  return scope
}

/**
 * Is the LIVE gateway multiplexing? Config is not evidence —
 * `gateway.multiplex_profiles: true` in `config.yaml` says nothing about how
 * the running process was started, and the whole point of the multiplex
 * caveat is that it changes where `key_env` resolves from.
 */
async function isMultiplexing(): Promise<boolean> {
  try {
    return (await getGatewayMode()).mode === 'multiplex'
  } catch {
    return false
  }
}

function readKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim()
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) ? key : null
}

export const Route = createFileRoute('/api/credentials')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authResult = isAuthenticated(request) as AuthResult
        if (authResult !== true) return authResult

        const scope = scopeFromRequest(request)
        const report = await collectCredentialStatuses({
          scope,
          multiplex: await isMultiplexing(),
        })

        return Response.json({
          ok: true,
          ...report,
          // Explicit, because "no statuses" and "we could not look" render
          // identically otherwise — the failure this endpoint exists to stop.
          degraded: report.unreachable.length > 0,
        })
      },

      /**
       * Save a credential. `{ key, value, verify?: true }`.
       *
       * With `verify`, the value is probed against the provider BEFORE it is
       * written, and a definitive rejection blocks the save. A probe that
       * cannot run (offline, or no probe registered for this var) never blocks
       * — `reachable: false` is not evidence of a bad key.
       */
      PUT: async ({ request }) => {
        const authResult = isAuthenticated(request) as AuthResult
        if (authResult !== true) return authResult
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        let body: { key?: unknown; value?: unknown; verify?: unknown }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return Response.json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }

        const key = readKey(body.key)
        if (!key) {
          return Response.json(
            {
              ok: false,
              error: 'A valid environment variable name is required',
            },
            { status: 400 },
          )
        }
        if (typeof body.value !== 'string' || body.value.trim() === '') {
          return Response.json(
            { ok: false, error: 'A non-empty value is required' },
            { status: 400 },
          )
        }
        const value = body.value.trim()

        let verification:
          | { ok: boolean; reachable: boolean; message: string }
          | undefined
        if (body.verify === true) {
          try {
            const probe = await validateProviderCredential(key, value)
            verification = {
              ok: probe.ok === true,
              reachable: probe.reachable === true,
              message: probe.message ?? '',
            }
            if (verification.reachable && !verification.ok) {
              return Response.json(
                {
                  ok: false,
                  error:
                    verification.message ||
                    'The provider rejected that key. It was not saved.',
                  verification,
                },
                { status: 422 },
              )
            }
          } catch {
            verification = {
              ok: false,
              reachable: false,
              message: 'Could not reach the provider to verify the key.',
            }
          }
        }

        const outcome = await saveCredential(key, value, {
          scope: scopeFromRequest(request),
        })
        return Response.json({ ...outcome, verification })
      },

      DELETE: async ({ request }) => {
        const authResult = isAuthenticated(request) as AuthResult
        if (authResult !== true) return authResult
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        let body: { key?: unknown }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return Response.json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }

        const key = readKey(body.key)
        if (!key) {
          return Response.json(
            {
              ok: false,
              error: 'A valid environment variable name is required',
            },
            { status: 400 },
          )
        }

        const outcome = await removeCredential(key, {
          scope: scopeFromRequest(request),
        })
        return Response.json(outcome)
      },
    },
  },
})
