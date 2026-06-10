/**
 * Jobs API proxy — forwards individual job operations to Hermes Agent FastAPI
 * or the upstream dashboard cron API.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  BEARER_TOKEN,
  CLAUDE_API,
  CLAUDE_UPGRADE_INSTRUCTIONS,
  dashboardFetch,
  ensureGatewayProbed,
} from '../../server/gateway-capabilities'
import { deleteSession, listSessions } from '../../server/hermes-api'

function authHeaders(): Record<string, string> {
  return BEARER_TOKEN ? { Authorization: `Bearer ${BEARER_TOKEN}` } : {}
}

function notSupported(): Response {
  return new Response(
    JSON.stringify({
      error: `Gateway does not support /api/jobs. ${CLAUDE_UPGRADE_INSTRUCTIONS}`,
    }),
    { status: 404, headers: { 'Content-Type': 'application/json' } },
  )
}

function dashboardJobPath(
  jobId: string,
  action: string,
  url: URL,
): string {
  const dashboardAction =
    action === 'run' ? 'trigger' : action === 'output' ? 'runs' : action
  const path = dashboardAction
    ? `/api/cron/jobs/${jobId}/${dashboardAction}`
    : `/api/cron/jobs/${jobId}`
  const search = new URLSearchParams(url.searchParams)
  search.delete('action')
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

function isRunHistoryAction(action: string): boolean {
  return action === 'runs' || action === 'output'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function synthesizeRunsFromJobDetail(
  value: unknown,
  chatSessionKey?: string,
): { runs: Array<unknown>; historySource?: string; totalRuns?: number; historyNote?: string } {
  const job = asRecord(value)
  const explicitRuns = job.runs
  if (Array.isArray(explicitRuns)) return { runs: explicitRuns, historySource: 'runs' }

  const totalRuns =
    typeof asRecord(job.repeat).completed === 'number'
      ? (asRecord(job.repeat).completed as number)
      : typeof job.run_count === 'number'
        ? job.run_count
        : undefined
  const historyNote = totalRuns && totalRuns > 1
    ? `Gateway exposes only the latest run here; ${totalRuns} total runs are recorded for this cron job.`
    : 'Gateway exposes only the latest run for this cron job.'

  const lastRun = asRecord(job.lastRun ?? job.last_run)
  if (Object.keys(lastRun).length > 0) {
    return {
      runs: [{ ...lastRun, ...(chatSessionKey ? { chatSessionKey } : {}) }],
      historySource: 'lastRunFallback',
      totalRuns,
      historyNote,
    }
  }

  const lastRunAt = job.last_run_at ?? job.lastRunAt
  if (typeof lastRunAt !== 'string' || !lastRunAt.trim()) {
    return { runs: [], historySource: 'lastRunFallback', totalRuns, historyNote }
  }

  return {
    historySource: 'lastRunFallback',
    totalRuns,
    historyNote,
    runs: [
      {
        id: job.last_run_id ?? job.lastRunId ?? `last-run-${lastRunAt}`,
        status: job.last_status ?? job.lastRunStatus ?? job.last_run_success,
        startedAt: lastRunAt,
        finishedAt: job.last_completed_at ?? job.lastRunCompletedAt,
        error: job.last_error ?? job.last_run_error,
        deliverySummary: job.last_delivery_error
          ? `Delivery error: ${job.last_delivery_error}`
          : undefined,
        ...(chatSessionKey ? { chatSessionKey } : {}),
      },
    ],
  }
}

function collectLinkedSessionKeys(value: unknown): Set<string> {
  const keys = new Set<string>()
  const seen = new Set<unknown>()
  const sessionKeyFields = new Set([
    'chatSessionKey',
    'chat_session_key',
    'friendlyId',
    'friendly_id',
    'sessionKey',
    'session_key',
    'sessionId',
    'session_id',
  ])

  function visit(node: unknown): void {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)

    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }

    for (const [field, child] of Object.entries(node)) {
      if (
        sessionKeyFields.has(field) &&
        typeof child === 'string' &&
        child.trim()
      ) {
        keys.add(child.trim())
      }
      visit(child)
    }
  }

  visit(value)
  return keys
}

function sessionKeyFromRecord(value: unknown): string | null {
  const record = asRecord(value)
  for (const field of ['key', 'friendlyId', 'friendly_id', 'sessionKey', 'session_key', 'id']) {
    const candidate = record[field]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

async function collectCronSessionKeysFromSessions(jobId: string): Promise<Array<string>> {
  const prefix = `cron_${jobId}_`
  try {
    const sessions = await listSessions(1000, 0)
    const keys = new Set<string>()
    for (const session of sessions as Array<unknown>) {
      const key = sessionKeyFromRecord(session)
      if (key?.startsWith(prefix)) keys.add(key)
    }
    return [...keys]
  } catch {
    return []
  }
}

async function getLatestCronSessionKey(jobId: string): Promise<string | undefined> {
  const keys = await collectCronSessionKeysFromSessions(jobId)
  return keys.sort().at(-1)
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function dashboardRunHistoryResponse(
  jobId: string,
  action: string,
  url: URL,
): Promise<Response> {
  const runsResponse = await dashboardFetch(dashboardJobPath(jobId, action, url))
  if (runsResponse.ok || !isRunHistoryAction(action)) return runsResponse

  const detailResponse = await dashboardFetch(`/api/cron/jobs/${jobId}`)
  if (!detailResponse.ok) return runsResponse

  const detail = await readJsonSafely(detailResponse)
  const latestSessionKey = await getLatestCronSessionKey(jobId)

  return new Response(
    JSON.stringify(synthesizeRunsFromJobDetail(detail, latestSessionKey)),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

async function collectDashboardRunSessionKeys(jobId: string): Promise<Array<string>> {
  try {
    const keys = new Set<string>(await collectCronSessionKeysFromSessions(jobId))
    const runsResponse = await dashboardRunHistoryResponse(
      jobId,
      'runs',
      new URL(`http://localhost/api/claude-jobs/${jobId}?action=runs&limit=100`),
    )
    if (runsResponse.ok) {
      for (const key of collectLinkedSessionKeys(await readJsonSafely(runsResponse))) {
        keys.add(key)
      }
    }
    return [...keys]
  } catch {
    return []
  }
}

async function deleteLinkedSessions(sessionKeys: Array<string>): Promise<{
  deleted: Array<string>
  failed: Array<{ sessionKey: string; error: string }>
}> {
  const deleted: Array<string> = []
  const failed: Array<{ sessionKey: string; error: string }> = []

  for (const sessionKey of sessionKeys) {
    try {
      await deleteSession(sessionKey)
      deleted.push(sessionKey)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes(': 404')) {
        deleted.push(sessionKey)
      } else {
        failed.push({ sessionKey, error: message })
      }
    }
  }

  return { deleted, failed }
}

export const Route = createFileRoute('/api/claude-jobs/$jobId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
          })
        }
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.jobs) return notSupported()

        const url = new URL(request.url)
        const action = url.searchParams.get('action') || ''

        if (capabilities.dashboard.available) {
          const res = isRunHistoryAction(action)
            ? await dashboardRunHistoryResponse(params.jobId, action, url)
            : await dashboardFetch(dashboardJobPath(params.jobId, action, url))
          return new Response(await res.text(), {
            status: res.status,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const target = action
          ? `${CLAUDE_API}/api/jobs/${params.jobId}/${action}${url.search}`
          : `${CLAUDE_API}/api/jobs/${params.jobId}`
        const res = await fetch(target, { headers: authHeaders() })
        return new Response(await res.text(), {
          status: res.status,
          headers: { 'Content-Type': 'application/json' },
        })
      },
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
          })
        }
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.jobs) return notSupported()

        const url = new URL(request.url)
        const action = url.searchParams.get('action') || ''
        const body = await request.text()

        if (capabilities.dashboard.available) {
          const dashboardAction = action === 'run' ? 'trigger' : action
          const dashboardPath = dashboardAction
            ? `/api/cron/jobs/${params.jobId}/${dashboardAction}`
            : `/api/cron/jobs/${params.jobId}`
          const method = dashboardAction ? 'POST' : 'PUT'
          const res = await dashboardFetch(dashboardPath, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body || undefined,
          })
          return new Response(await res.text(), {
            status: res.status,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const target = action
          ? `${CLAUDE_API}/api/jobs/${params.jobId}/${action}`
          : `${CLAUDE_API}/api/jobs/${params.jobId}`
        const res = await fetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: body || undefined,
        })
        return new Response(await res.text(), {
          status: res.status,
          headers: { 'Content-Type': 'application/json' },
        })
      },
      PATCH: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
          })
        }
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.jobs) return notSupported()

        const body = await request.text()
        const res = capabilities.dashboard.available
          ? await dashboardFetch(`/api/cron/jobs/${params.jobId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ updates: body ? JSON.parse(body) : {} }),
            })
          : await fetch(`${CLAUDE_API}/api/jobs/${params.jobId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', ...authHeaders() },
              body,
            })
        return new Response(await res.text(), {
          status: res.status,
          headers: { 'Content-Type': 'application/json' },
        })
      },
      DELETE: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
          })
        }
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.jobs) return notSupported()

        const linkedSessionKeys = capabilities.dashboard.available
          ? await collectDashboardRunSessionKeys(params.jobId)
          : []
        const res = capabilities.dashboard.available
          ? await dashboardFetch(`/api/cron/jobs/${params.jobId}`, {
              method: 'DELETE',
            })
          : await fetch(`${CLAUDE_API}/api/jobs/${params.jobId}`, {
              method: 'DELETE',
              headers: authHeaders(),
            })
        const text = await res.text()
        if (res.ok && linkedSessionKeys.length > 0) {
          const sessionCleanup = await deleteLinkedSessions(linkedSessionKeys)
          let payload: Record<string, unknown> = {}
          try {
            payload = text.trim()
              ? (JSON.parse(text) as Record<string, unknown>)
              : {}
          } catch {
            payload = { ok: true, message: text }
          }
          return new Response(JSON.stringify({ ...payload, sessionCleanup }), {
            status: res.status,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return new Response(text, {
          status: res.status,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
