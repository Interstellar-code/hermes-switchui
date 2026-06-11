/**
 * Server-only client for the karpathy-self-improve dashboard plugin.
 *
 * All HTTP calls use dashboardFetch() from gateway-capabilities.ts — never
 * import this module in client-side code.
 */
import { dashboardFetch } from './gateway-capabilities'
import type {
  Baseline,
  BaselinesResponse,
  CollectResponse,
  CreateExperimentBody,
  Experiment,
  ExperimentHistoryResponse,
  ExperimentsResponse,
  MetricsResponse,
  MetricsSnapshot,
  PluginHealth,
  ProposeResponse,
  ProposeSkippedResponse,
} from '../lib/self-improve-types'

const BASE = '/api/plugins/karpathy-self-improve'

// Must exceed worst-case dashboardFetch auth flow (cold-cache 401 retry = ~6s).
const FETCH_TIMEOUT_MS = 12_000

async function selfImproveFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await dashboardFetch(path, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    let detail = `Self-Improve API error ${res.status}`
    try {
      const body = (await res.json()) as { detail?: string; error?: string }
      detail = body.detail ?? body.error ?? detail
    } catch {
      // ignore parse failure
    }
    throw new Error(`Self-Improve API error ${res.status}: ${detail}`)
  }
  return res.json() as Promise<T>
}

// ── Exported API functions ────────────────────────────────────────────────────

export async function getHealth(): Promise<PluginHealth> {
  return selfImproveFetch<PluginHealth>(`${BASE}/health`)
}

export async function listMetrics(params?: {
  profile?: string
  limit?: number
}): Promise<Array<MetricsSnapshot>> {
  const q = new URLSearchParams()
  if (params?.profile) q.set('profile', params.profile)
  if (params?.limit !== undefined) q.set('limit', String(params.limit))
  const qs = q.toString()
  const { metrics } = await selfImproveFetch<MetricsResponse>(
    `${BASE}/metrics${qs ? `?${qs}` : ''}`,
  )
  return metrics
}

export async function latestMetrics(): Promise<Array<MetricsSnapshot>> {
  const { metrics } = await selfImproveFetch<MetricsResponse>(`${BASE}/metrics/latest`)
  return metrics
}

export async function listBaselines(params?: {
  profile?: string
}): Promise<Array<Baseline>> {
  const q = new URLSearchParams()
  if (params?.profile) q.set('profile', params.profile)
  const qs = q.toString()
  const { baselines } = await selfImproveFetch<BaselinesResponse>(
    `${BASE}/baselines${qs ? `?${qs}` : ''}`,
  )
  return baselines
}

export async function collectMetrics(): Promise<CollectResponse> {
  return selfImproveFetch<CollectResponse>(`${BASE}/metrics/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── Experiments ───────────────────────────────────────────────────────────────

export async function listExperiments(params?: {
  profile?: string
  state?: string
}): Promise<Array<Experiment>> {
  const q = new URLSearchParams()
  if (params?.profile) q.set('profile', params.profile)
  if (params?.state) q.set('state', params.state)
  const qs = q.toString()
  const { experiments } = await selfImproveFetch<ExperimentsResponse>(
    `${BASE}/experiments${qs ? `?${qs}` : ''}`,
  )
  return experiments
}

export async function getExperiment(id: number): Promise<Experiment> {
  return selfImproveFetch<Experiment>(`${BASE}/experiments/${id}`)
}

export async function getExperimentHistory(id: number): Promise<ExperimentHistoryResponse> {
  return selfImproveFetch<ExperimentHistoryResponse>(`${BASE}/experiments/${id}/history`)
}

export async function createExperiment(body: CreateExperimentBody): Promise<{ experiment_id: number }> {
  return selfImproveFetch<{ experiment_id: number }>(`${BASE}/experiments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function approveExperiment(
  id: number,
  actor: string,
): Promise<{ ok: boolean; state: string }> {
  return selfImproveFetch<{ ok: boolean; state: string }>(`${BASE}/experiments/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor }),
  })
}

export async function rejectExperiment(
  id: number,
  actor: string,
  reason: string,
): Promise<{ ok: boolean; state: string }> {
  return selfImproveFetch<{ ok: boolean; state: string }>(`${BASE}/experiments/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor, reason }),
  })
}

export async function proposeExperiment(
  profile: string,
): Promise<ProposeResponse | ProposeSkippedResponse> {
  return selfImproveFetch<ProposeResponse | ProposeSkippedResponse>(`${BASE}/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile }),
  })
}

// ── Lifecycle actions (P2) ────────────────────────────────────────────────────

export async function applyExperiment(
  id: number,
): Promise<{ ok: boolean; state: 'live'; apply_commit_sha: string }> {
  return selfImproveFetch<{ ok: boolean; state: 'live'; apply_commit_sha: string }>(
    `${BASE}/experiments/${id}/apply`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
}

export async function verifyExperiment(
  id: number,
): Promise<{ ok: boolean; state: 'verified' }> {
  return selfImproveFetch<{ ok: boolean; state: 'verified' }>(
    `${BASE}/experiments/${id}/verify`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
}

export async function revertExperiment(
  id: number,
  reason: string,
): Promise<{ ok: boolean; state: 'reverted' }> {
  return selfImproveFetch<{ ok: boolean; state: 'reverted' }>(
    `${BASE}/experiments/${id}/revert`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    },
  )
}
