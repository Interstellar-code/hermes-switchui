/**
 * `POST /api/runs/:runId/approval` — resolve a blocking command approval.
 *
 * Thin proxy onto the gateway's `POST /v1/runs/{run_id}/approval`
 * (approval contract v1 §2). Two things about that endpoint drive the shape
 * of this one:
 *
 * 1. **Resolution is keyed by `run_id` alone.** The gateway never reads
 *    `approval_id`; it pops the oldest entry from the run's FIFO queue. So
 *    this route takes a run id and nothing else identifying, and the UI is
 *    responsible for never having two cards outstanding for one run.
 *
 * 2. **`409` and `404` are benign, not failures.** They mean the approval is
 *    gone — answered elsewhere, the run ended, or it timed out and was
 *    fail-closed auto-denied. The gateway's own tests use the two 409 codes
 *    interchangeably, so we do not try to tell them apart. We flag them as
 *    `benign: true` so the card can close with an explanation instead of a
 *    scary error, while still passing the real status through for anything
 *    else reading this route. `400`/`401`/`500` are real and stay loud.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { gatewayFetch } from '../../server/gateway-capabilities'
import {
  assertProfileServed,
  isProfileScopeError,
  profileErrorStatus,
  readProfile,
  scopedPath,
} from '../../server/profile-scope'
import { isApprovalChoice } from '../../lib/approvals'

/** Gateway aliases, lowercased and stripped before validation. */
const CHOICE_ALIASES: Record<string, string> = {
  approve: 'once',
  approved: 'once',
  allow: 'once',
}

export const Route = createFileRoute('/api/runs/$runId/approval')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }

        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const runId = params.runId.trim()
        if (!runId) {
          return Response.json(
            { ok: false, error: 'runId required' },
            { status: 400 },
          )
        }

        let body: { choice?: unknown; all?: unknown; profile?: unknown }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return Response.json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }

        const raw =
          typeof body.choice === 'string' ? body.choice.trim().toLowerCase() : ''
        const choice = CHOICE_ALIASES[raw] ?? raw
        if (!isApprovalChoice(choice)) {
          return Response.json(
            {
              ok: false,
              error:
                'Invalid approval choice; expected one of: once, session, always, deny',
            },
            { status: 400 },
          )
        }

        // Fail closed before touching the gateway: a run created under one
        // profile must be resolved under the same prefix, and the gateway's
        // approval registry has no profile component of its own to catch a
        // mismatch.
        const profile = readProfile(body.profile)
        try {
          if (profile) await assertProfileServed(profile)
        } catch (err) {
          if (!isProfileScopeError(err)) throw err
          return Response.json(
            { ok: false, error: (err as Error).message },
            { status: profileErrorStatus(err) },
          )
        }

        try {
          const res = await gatewayFetch(
            await scopedPath(
              `/v1/runs/${encodeURIComponent(runId)}/approval`,
              profile,
            ),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                choice,
                ...(body.all === true ? { all: true } : {}),
              }),
              signal: AbortSignal.timeout(15_000),
            },
          )

          const json = (await res.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          if (res.ok) {
            return Response.json({ ok: true, ...json }, { status: 200 })
          }

          if (res.status === 409 || res.status === 404) {
            return Response.json(
              {
                ok: false,
                benign: true,
                reason: res.status === 404 ? 'run_not_found' : 'not_pending',
                error: gatewayErrorMessage(json),
              },
              { status: res.status },
            )
          }

          return Response.json(
            { ok: false, error: gatewayErrorMessage(json) },
            { status: res.status },
          )
        } catch (err) {
          if (isProfileScopeError(err)) {
            return Response.json(
              { ok: false, error: (err as Error).message },
              { status: profileErrorStatus(err) },
            )
          }
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})

function gatewayErrorMessage(json: Record<string, unknown>): string {
  const error = json.error
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'Approval request failed'
}
