/**
 * `POST /api/runs/:runId/stop` — ask the gateway to stop a live run.
 *
 * Thin proxy onto `POST /v1/runs/{run_id}/stop`, shaped like its sibling
 * `runs.$runId.approval.ts` (auth → CSRF → profile scope → gateway → mapped
 * result). Four things about that endpoint drive this one:
 *
 * 1. **The client has no run id.** The real gateway run id arrives on the
 *    `started` SSE event and is never threaded into the abort path, so the UI
 *    addresses the run as `/api/runs/active/stop` and passes `sessionKey` in
 *    the body. We resolve the id from `run-store.ts` — the same store
 *    `GET /api/sessions/:sessionKey/active-run` reads — under the same
 *    `scopeKey(profile, sessionKey)` composite the writer used. An explicit
 *    run id in the path still works and skips the lookup.
 *
 * 2. **`404` means three different things.** The gateway answers
 *    `404 run_not_found` for an unknown run AND for one that already finished
 *    (its `finally` popped the refs before the call landed). So a 404 is
 *    followed by `GET /v1/runs/{id}`: a terminal status proves "already
 *    finished, nothing to stop" (`benign: true`), a live status means the run
 *    exists but the gateway is not tracking it as stoppable
 *    (`not_stoppable`), and a second 404 means we simply do not know
 *    (`run_not_found`). Only the first is benign — see `src/lib/run-stop.ts`.
 *
 * 3. **Stop is cooperative.** A `200` means the flag is set and
 *    `agent.interrupt()` was called; it does NOT mean the run stopped. The
 *    status is `stopping` and stays that way, with no upper bound, until the
 *    executor returns. Callers must poll `GET /api/runs/:runId/status` for
 *    `cancelled`. Nothing here waits for it.
 *
 * 4. **The gateway reads no body.** It ignores request bodies entirely, so an
 *    absent or unparseable body is not a 400 — the body only ever carried our
 *    own routing hints (`sessionKey`, `profile`). `requireJsonContentType`
 *    still runs first: it is the CSRF check, not a schema check.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { gatewayFetch } from '../../server/gateway-capabilities'
import { getActiveRunForSession } from '../../server/run-store'
import {
  assertProfileServed,
  isProfileScopeError,
  profileErrorStatus,
  readProfile,
  scopedPath,
} from '../../server/profile-scope'
import {
  ACTIVE_RUN_TOKEN,
  gatewayErrorMessage,
  isTerminalRunStatus,
  readRunStatus,
} from '../../lib/run-stop'
import type { RunStopResponse } from '../../lib/run-stop'
import { scopeKey } from '@/lib/session-scope'

const GATEWAY_TIMEOUT_MS = 15_000

export const Route = createFileRoute('/api/runs/$runId/stop')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' } satisfies RunStopResponse,
            { status: 401 },
          )
        }

        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        // The gateway never parses the body; ours only carries routing hints.
        // A malformed body therefore degrades to "no hints", not to a 400.
        const body = (await request.json().catch(() => ({}))) as {
          sessionKey?: unknown
          profile?: unknown
        }

        // Fail closed before touching the gateway, exactly as the approval
        // proxy does: a run created under one profile must be addressed under
        // the same prefix, and the gateway keys run bookkeeping by bare run id
        // with no profile component of its own to catch a mismatch.
        const profile = readProfile(body.profile)
        try {
          if (profile) await assertProfileServed(profile)
        } catch (err) {
          if (!isProfileScopeError(err)) throw err
          return Response.json(
            {
              ok: false,
              error: (err as Error).message,
            } satisfies RunStopResponse,
            { status: profileErrorStatus(err) },
          )
        }

        const pathRunId = params.runId.trim()
        if (!pathRunId) {
          return Response.json(
            { ok: false, error: 'runId required' } satisfies RunStopResponse,
            { status: 400 },
          )
        }

        try {
          let runId = pathRunId
          if (runId === ACTIVE_RUN_TOKEN) {
            const sessionKey =
              typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''
            if (!sessionKey) {
              return Response.json(
                {
                  ok: false,
                  error: `sessionKey required when the run id is "${ACTIVE_RUN_TOKEN}"`,
                } satisfies RunStopResponse,
                { status: 400 },
              )
            }
            const run = await getActiveRunForSession(
              scopeKey(profile, sessionKey),
            )
            if (!run?.runId) {
              // Not benign: no record here is not proof the agent stopped.
              return Response.json(
                {
                  ok: false,
                  benign: false,
                  reason: 'no_active_run',
                  error: 'No tracked run for this session',
                } satisfies RunStopResponse,
                { status: 404 },
              )
            }
            runId = run.runId
          }

          const encodedRunId = encodeURIComponent(runId)
          const res = await gatewayFetch(
            await scopedPath(`/v1/runs/${encodedRunId}/stop`, profile),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
            },
          )

          const json = (await res.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          if (res.ok) {
            // 200 == "the flag is set", never "it stopped". Report the
            // gateway's own status word so the caller cannot mistake one for
            // the other.
            return Response.json(
              {
                ok: true,
                reason: 'stopping',
                runId,
                status: readRunStatus(json) ?? 'stopping',
              } satisfies RunStopResponse,
              { status: 200 },
            )
          }

          if (res.status === 404) {
            const probed = await probeRunStatus(encodedRunId, profile)

            if (probed.found && isTerminalRunStatus(probed.status)) {
              return Response.json(
                {
                  ok: false,
                  benign: true,
                  reason: 'already_finished',
                  runId,
                  status: probed.status,
                } satisfies RunStopResponse,
                { status: 404 },
              )
            }

            if (probed.found) {
              // The run exists and is not finished, yet the gateway will not
              // stop it — today's sessions-stream runs are registered for
              // approvals but not for stop. The agent is still going.
              return Response.json(
                {
                  ok: false,
                  benign: false,
                  reason: 'not_stoppable',
                  runId,
                  status: probed.status,
                } satisfies RunStopResponse,
                { status: 404 },
              )
            }

            return Response.json(
              {
                ok: false,
                benign: false,
                reason: 'run_not_found',
                runId,
                error: gatewayErrorMessage(json, `Run not found: ${runId}`),
              } satisfies RunStopResponse,
              { status: 404 },
            )
          }

          return Response.json(
            {
              ok: false,
              reason: 'error',
              runId,
              error: gatewayErrorMessage(json, 'Stop request failed'),
            } satisfies RunStopResponse,
            { status: res.status },
          )
        } catch (err) {
          if (isProfileScopeError(err)) {
            return Response.json(
              {
                ok: false,
                error: (err as Error).message,
              } satisfies RunStopResponse,
              { status: profileErrorStatus(err) },
            )
          }
          return Response.json(
            {
              ok: false,
              reason: 'error',
              error: err instanceof Error ? err.message : String(err),
            } satisfies RunStopResponse,
            { status: 500 },
          )
        }
      },
    },
  },
})

/**
 * Disambiguate a stop 404 with `GET /v1/runs/{run_id}` — the reliable channel.
 *
 * `found: false` covers both "the gateway 404s this id too" and "the probe
 * itself failed", because neither tells us anything about the agent. Only a
 * 200 lets us claim knowledge.
 */
async function probeRunStatus(
  encodedRunId: string,
  profile: string | null,
): Promise<{ found: boolean; status?: string }> {
  try {
    const res = await gatewayFetch(
      await scopedPath(`/v1/runs/${encodedRunId}`, profile),
      { signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) },
    )
    if (!res.ok) return { found: false }
    const json = await res.json().catch(() => ({}))
    return { found: true, status: readRunStatus(json) }
  } catch {
    return { found: false }
  }
}
