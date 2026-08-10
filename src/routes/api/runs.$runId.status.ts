/**
 * `GET /api/runs/:runId/status` — read a run's lifecycle status.
 *
 * Passthrough onto the gateway's `GET /v1/runs/{run_id}`. It exists because
 * stop is cooperative and emits no SSE event of its own: the status poll is
 * the ONLY reliable way to learn that a stop actually took (`stopping` →
 * `cancelled`). A stream that merely goes quiet proves nothing.
 *
 * Sibling of `runs.$runId.stop.ts` rather than a bare `runs.$runId.ts` so it
 * cannot become a parent route of the existing `runs.$runId.approval.ts`.
 *
 * A 404 here is reported as `benign` — after a run's status record ages out
 * (the gateway keeps it an hour) there is nothing wrong, there is just nothing
 * to read. Callers still must not read "record gone" as "run stopped"; see
 * `use-run-stop.ts`, which treats it as unconfirmed.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { gatewayFetch } from '../../server/gateway-capabilities'
import {
  isProfileScopeError,
  profileErrorStatus,
  readProfile,
  scopedPath,
} from '../../server/profile-scope'
import { gatewayErrorMessage, readRunStatus } from '../../lib/run-stop'
import type { RunStatusResponse } from '../../lib/run-stop'

const GATEWAY_TIMEOUT_MS = 15_000

export const Route = createFileRoute('/api/runs/$runId/status')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' } satisfies RunStatusResponse,
            { status: 401 },
          )
        }

        const runId = params.runId.trim()
        if (!runId) {
          return Response.json(
            { ok: false, error: 'runId required' } satisfies RunStatusResponse,
            { status: 400 },
          )
        }

        const profile = readProfile(
          new URL(request.url).searchParams.get('profile'),
        )

        try {
          const res = await gatewayFetch(
            await scopedPath(`/v1/runs/${encodeURIComponent(runId)}`, profile),
            { signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) },
          )
          const json = (await res.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          if (res.ok) {
            return Response.json(
              {
                ok: true,
                runId,
                status: readRunStatus(json),
              } satisfies RunStatusResponse,
              { status: 200 },
            )
          }

          if (res.status === 404) {
            return Response.json(
              {
                ok: false,
                benign: true,
                reason: 'run_not_found',
                runId,
                error: gatewayErrorMessage(json, `Run not found: ${runId}`),
              } satisfies RunStatusResponse,
              { status: 404 },
            )
          }

          return Response.json(
            {
              ok: false,
              runId,
              error: gatewayErrorMessage(json, 'Run status request failed'),
            } satisfies RunStatusResponse,
            { status: res.status },
          )
        } catch (err) {
          if (isProfileScopeError(err)) {
            return Response.json(
              {
                ok: false,
                error: (err as Error).message,
              } satisfies RunStatusResponse,
              { status: profileErrorStatus(err) },
            )
          }
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            } satisfies RunStatusResponse,
            { status: 500 },
          )
        }
      },
    },
  },
})
