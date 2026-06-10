/**
 * Jobs API client — talks to Hermes Agent FastAPI /api/jobs endpoints.
 */

const CLAUDE_API = '/api/claude-jobs'

export type ClaudeJob = {
  id: string
  name: string
  prompt: string
  schedule: Record<string, unknown>
  schedule_display?: string
  enabled: boolean
  state: string
  next_run_at?: string | null
  last_run_at?: string | null
  last_run_success?: boolean | null
  last_run_error?: string | null
  error?: string | null
  created_at?: string
  updated_at?: string
  deliver?: Array<string>
  skills?: Array<string>
  repeat?: { times?: number; completed?: number }
  run_count?: number
}

export type HermesJob = ClaudeJob

export type JobOutput = {
  filename: string
  timestamp: string
  content: string
  size: number
  source?: 'runs' | 'lastRunFallback'
  totalRuns?: number
  historyNote?: string
}

function stringifyJobOutput(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function normalizeJobOutputs(data: unknown): Array<JobOutput> {
  if (!data || typeof data !== 'object') return []
  const record = data as Record<string, unknown>
  if (Array.isArray(record.outputs)) return record.outputs as Array<JobOutput>

  const historySource =
    record.historySource === 'lastRunFallback' ? 'lastRunFallback' : 'runs'
  const totalRuns = typeof record.totalRuns === 'number' ? record.totalRuns : undefined
  const historyNote =
    typeof record.historyNote === 'string' ? record.historyNote : undefined
  const runs = Array.isArray(record.runs) ? record.runs : []
  return runs.map((run, index) => {
    const row =
      run && typeof run === 'object' ? (run as Record<string, unknown>) : {}
    const output = row.output
    const content =
      stringifyJobOutput(output) ||
      stringifyJobOutput(row.deliverySummary) ||
      stringifyJobOutput(row.summary) ||
      stringifyJobOutput(row.error) ||
      stringifyJobOutput(row)
    const timestamp =
      typeof row.startedAt === 'string'
        ? row.startedAt
        : typeof row.started_at === 'string'
          ? row.started_at
          : typeof row.createdAt === 'string'
            ? row.createdAt
            : typeof row.timestamp === 'string'
              ? row.timestamp
              : ''
    const filename =
      (typeof row.id === 'string' && row.id) ||
      (typeof row.runId === 'string' && row.runId) ||
      `run-${index + 1}`

    return {
      filename,
      timestamp,
      content,
      size: content.length,
      source: historySource,
      totalRuns,
      historyNote,
    }
  })
}

type JobMutationInput = {
  schedule: string
  prompt: string
  name?: string
  deliver?: Array<string>
  skills?: Array<string>
  repeat?: number
}

type JobMutationPayload = Omit<JobMutationInput, 'deliver'> & {
  deliver?: Array<string> | string
  input: string
}

export function normalizeJobsResponse(data: unknown): Array<ClaudeJob> {
  if (Array.isArray(data)) return data as Array<ClaudeJob>
  if (
    typeof data === 'object' &&
    data !== null &&
    'jobs' in data &&
    Array.isArray((data as { jobs?: unknown }).jobs)
  ) {
    return (data as { jobs: Array<ClaudeJob> }).jobs
  }
  return []
}

export function findJobById(
  jobs: Array<ClaudeJob>,
  jobId: string | null | undefined,
): ClaudeJob | null {
  if (!jobId) return null
  return jobs.find((job) => job.id === jobId) ?? null
}

export function normalizeJobState(state: unknown): string | null {
  return typeof state === 'string' && state.trim()
    ? state.trim().toLowerCase()
    : null
}

export function isFailedJobState(state: unknown): boolean {
  const normalized = normalizeJobState(state)
  return (
    normalized === 'failed' ||
    normalized === 'error' ||
    normalized === 'errored' ||
    normalized === 'cancelled' ||
    normalized === 'canceled' ||
    normalized === 'aborted'
  )
}

export function isTerminalJobState(state: unknown): boolean {
  const normalized = normalizeJobState(state)
  return (
    normalized === 'completed' ||
    normalized === 'complete' ||
    normalized === 'succeeded' ||
    normalized === 'success' ||
    normalized === 'finished' ||
    normalized === 'done' ||
    isFailedJobState(normalized)
  )
}

export function getLatestJobOutputText(outputs: Array<JobOutput>): string {
  let latestContent = ''
  let latestTimestamp = Number.NEGATIVE_INFINITY

  for (const output of outputs) {
    const content =
      typeof output.content === 'string' ? output.content.trim() : ''
    if (!content) continue

    const timestamp = new Date(output.timestamp).getTime()
    if (!Number.isFinite(timestamp) || timestamp < latestTimestamp) continue

    latestTimestamp = timestamp
    latestContent = content
  }

  return latestContent
}

export function getJobErrorText(
  job: ClaudeJob | null | undefined,
): string | null {
  if (!job) return null

  const candidates = [job.last_run_error, job.error]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return null
}

export async function fetchJobs(): Promise<Array<ClaudeJob>> {
  const res = await fetch(`${CLAUDE_API}?include_disabled=true`)
  if (!res.ok) throw new Error(`Failed to fetch jobs: ${res.status}`)
  const data = await res.json()
  return normalizeJobsResponse(data)
}

/**
 * Coerce an arbitrary error payload (string | object | array) into a single
 * human-readable message. Without this, FastAPI/Pydantic responses that
 * include a structured `detail` (e.g. an array of validation errors) end up
 * rendered as the literal string "[object Object]" by Error.message, which
 * is what users were seeing in the Create Job dialog. See #304.
 */
function errorMessageFromBody(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body
  if (body && typeof body === 'object') {
    const detail = (body as { detail?: unknown }).detail
    if (typeof detail === 'string' && detail.trim()) return detail
    if (Array.isArray(detail) && detail.length > 0) {
      return detail
        .map((item) => {
          if (typeof item === 'string') return item
          if (item && typeof item === 'object') {
            const msg =
              (item as { msg?: unknown; message?: unknown }).msg ??
              (item as { message?: unknown }).message
            if (typeof msg === 'string') return msg
          }
          return JSON.stringify(item)
        })
        .join('; ')
    }
    if (detail !== undefined) {
      try {
        return JSON.stringify(detail)
      } catch {
        // Fall through to message/error/fallback below.
      }
    }
    const message = (body as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
    const error = (body as { error?: unknown }).error
    if (typeof error === 'string' && error.trim()) return error
  }
  return fallback
}

export function buildJobMutationPayload(
  input: JobMutationInput,
): JobMutationPayload {
  const prompt = typeof input.prompt === 'string' ? input.prompt : ''
  const normalizedDeliver = Array.isArray(input.deliver)
    ? input.deliver.join(',')
    : input.deliver

  return {
    ...input,
    prompt,
    input: prompt,
    ...(normalizedDeliver !== undefined ? { deliver: normalizedDeliver } : {}),
  }
}

export async function createJob(input: JobMutationInput): Promise<ClaudeJob> {
  // Normalize deliver: backend expects a string, but the form sends an array
  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildJobMutationPayload(input)),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      errorMessageFromBody(body, `Failed to create job: ${res.status}`),
    )
  }
  return (await res.json()).job
}

export async function updateJob(
  jobId: string,
  updates: Record<string, unknown>,
): Promise<ClaudeJob> {
  const payload = { ...updates }
  if (typeof updates.prompt === 'string') {
    payload.input = updates.prompt
  }
  const res = await fetch(`${CLAUDE_API}/${jobId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      errorMessageFromBody(body, `Failed to update job: ${res.status}`),
    )
  }
  return (await res.json()).job
}

export async function deleteJob(jobId: string): Promise<void> {
  const res = await fetch(`${CLAUDE_API}/${jobId}`, { method: 'DELETE' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      errorMessageFromBody(body, `Failed to delete job: ${res.status}`),
    )
  }
}

export async function pauseJob(jobId: string): Promise<ClaudeJob> {
  const res = await fetch(`${CLAUDE_API}/${jobId}?action=pause`, {
    method: 'POST',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      errorMessageFromBody(body, `Failed to pause job: ${res.status}`),
    )
  }
  return (await res.json()).job
}

export async function resumeJob(jobId: string): Promise<ClaudeJob> {
  const res = await fetch(`${CLAUDE_API}/${jobId}?action=resume`, {
    method: 'POST',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      errorMessageFromBody(body, `Failed to resume job: ${res.status}`),
    )
  }
  return (await res.json()).job
}

export async function triggerJob(jobId: string): Promise<ClaudeJob> {
  const res = await fetch(`${CLAUDE_API}/${jobId}?action=run`, {
    method: 'POST',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      errorMessageFromBody(body, `Failed to trigger job: ${res.status}`),
    )
  }
  return (await res.json()).job
}

export async function fetchJobOutput(
  jobId: string,
  limit = 10,
): Promise<Array<JobOutput>> {
  const res = await fetch(`${CLAUDE_API}/${jobId}?action=runs&limit=${limit}`)
  if (!res.ok) throw new Error(`Failed to fetch output: ${res.status}`)
  return normalizeJobOutputs(await res.json())
}
