/**
 * Run-stop wire helpers — shared by `POST /api/runs/:runId/stop`,
 * `GET /api/runs/:runId/status` and the chat UI that calls them.
 *
 * Everything here is pure and wire-shaped (no fetching, no React) so the
 * server route and the client hook cannot drift on what a reason code means.
 *
 * ## Why the reasons exist at all
 *
 * The gateway's `POST /v1/runs/{run_id}/stop` answers `404 run_not_found` for
 * an unknown run AND for a run that has already finished — the two are
 * indistinguishable from the response alone (gateway contract §6). So a 404 is
 * never conclusive by itself; the route follows it with `GET /v1/runs/{id}`
 * and reports which of the three real situations it was:
 *
 * | situation                          | reason             | benign |
 * |------------------------------------|--------------------|--------|
 * | stop accepted                      | `stopping`         | n/a    |
 * | 404 + status is terminal           | `already_finished` | yes    |
 * | 404 + status is still live         | `not_stoppable`    | no     |
 * | 404 + status also 404              | `run_not_found`    | no     |
 * | no run recorded for this session   | `no_active_run`    | no     |
 * | anything else                      | `error`            | no     |
 *
 * `benign` follows the convention set by the approval proxy: an explicit flag
 * rather than the HTTP status, because 404 carries three different meanings
 * here. It means "we have positive confirmation there was nothing left to
 * stop" — NOT merely "no exception was thrown". Only `already_finished`
 * qualifies. Everything else leaves the caller genuinely unsure whether the
 * agent is still running, which is exactly the case where the UI must keep its
 * "may have continued server-side" safety net armed.
 */

/** Reason codes returned by `POST /api/runs/:runId/stop`. */
export type RunStopReason =
  /** The gateway accepted the stop. The run is unwinding, not yet stopped. */
  | 'stopping'
  /** Confirmed terminal before the stop landed. Nothing was left to stop. */
  | 'already_finished'
  /** The gateway does not track this run as stoppable, but it is still live. */
  | 'not_stoppable'
  /** The gateway has no record of this run at all. Fate unknown. */
  | 'run_not_found'
  /** This workspace has no run recorded for the session. Fate unknown. */
  | 'no_active_run'
  /** Transport/auth/5xx. Fate unknown. */
  | 'error'

export type RunStopResponse = {
  ok: boolean
  /** Positive confirmation there was nothing left to stop. See module docs. */
  benign?: boolean
  reason?: RunStopReason
  /** The gateway run id the stop was actually addressed to, when resolved. */
  runId?: string
  /** The gateway's `GET /v1/runs/{id}` status, when we managed to read one. */
  status?: string
  error?: string
}

export type RunStatusResponse = {
  ok: boolean
  benign?: boolean
  reason?: 'run_not_found'
  runId?: string
  status?: string
  error?: string
}

/**
 * Path token meaning "whichever run this session currently has".
 *
 * The Stop button has no run id in hand: the id arrives on the `started` SSE
 * event and is never threaded into the abort path. Rather than plumb it
 * through three hooks and race the event, the client addresses the run by
 * session and the route resolves the id from the server-side run store — the
 * same store `GET /api/sessions/:sessionKey/active-run` already reads. Real
 * gateway run ids are `run_`-prefixed, so this token cannot collide with one.
 */
export const ACTIVE_RUN_TOKEN = 'active'

/**
 * Gateway run statuses that mean the run is over.
 *
 * `stopping` is deliberately absent: it means "asked, still unwinding", and it
 * has no upper bound — an agent inside a tool with no interrupt check stays
 * `stopping` until that tool returns on its own.
 */
const TERMINAL_RUN_STATUSES = new Set([
  'completed',
  'complete',
  'failed',
  'error',
  'cancelled',
  'canceled',
])

export function isTerminalRunStatus(status: unknown): boolean {
  return (
    typeof status === 'string' &&
    TERMINAL_RUN_STATUSES.has(status.trim().toLowerCase())
  )
}

/** True only for the terminal status that means the stop itself took effect. */
export function isCancelledRunStatus(status: unknown): boolean {
  if (typeof status !== 'string') return false
  const normalized = status.trim().toLowerCase()
  return normalized === 'cancelled' || normalized === 'canceled'
}

/** Read `status` out of a gateway run record, tolerating the missing case. */
export function readRunStatus(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined
  const status = (json as Record<string, unknown>).status
  return typeof status === 'string' && status.trim() ? status.trim() : undefined
}

/** Pull a human message out of either gateway error envelope shape. */
export function gatewayErrorMessage(json: unknown, fallback: string): string {
  if (json && typeof json === 'object') {
    const error = (json as Record<string, unknown>).error
    if (typeof error === 'string' && error.trim()) return error
    if (error && typeof error === 'object') {
      const message = (error as Record<string, unknown>).message
      if (typeof message === 'string' && message.trim()) return message
    }
  }
  return fallback
}
