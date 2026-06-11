/**
 * Browser-side fetch client for the /api/self-improve/* proxy routes.
 * This module is safe to import in client components.
 */
import type {
  Baseline,
  BaselinesResponse,
  CollectResponse,
  CreateExperimentBody,
  CreateScenarioBody,
  CreateScenarioResponse,
  DeleteScenarioResponse,
  Experiment,
  ExperimentHistoryResponse,
  ExperimentsResponse,
  MetricsResponse,
  MetricsSnapshot,
  PauseResumeResponse,
  PluginHealth,
  ProposeResponse,
  ProposeSkippedResponse,
  Scenario,
  ScenariosResponse,
} from './self-improve-types'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    let msg = `Self-Improve API error ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) msg = body.error
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export async function fetchHealth(): Promise<PluginHealth> {
  return apiFetch<PluginHealth>('/api/self-improve/health')
}

export async function fetchLatestMetrics(): Promise<Array<MetricsSnapshot>> {
  const { metrics } = await apiFetch<MetricsResponse>('/api/self-improve/metrics/latest')
  return metrics
}

export async function fetchMetrics(params?: {
  profile?: string
  limit?: number
}): Promise<Array<MetricsSnapshot>> {
  const q = new URLSearchParams()
  if (params?.profile) q.set('profile', params.profile)
  if (params?.limit !== undefined) q.set('limit', String(params.limit))
  const qs = q.toString()
  const { metrics } = await apiFetch<MetricsResponse>(
    `/api/self-improve/metrics${qs ? `?${qs}` : ''}`,
  )
  return metrics
}

export async function fetchBaselines(params?: {
  profile?: string
}): Promise<Array<Baseline>> {
  const q = new URLSearchParams()
  if (params?.profile) q.set('profile', params.profile)
  const qs = q.toString()
  const { baselines } = await apiFetch<BaselinesResponse>(
    `/api/self-improve/baselines${qs ? `?${qs}` : ''}`,
  )
  return baselines
}

export async function triggerCollect(): Promise<CollectResponse> {
  return apiFetch<CollectResponse>('/api/self-improve/metrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── Experiments ───────────────────────────────────────────────────────────────

export async function fetchExperiments(params?: {
  profile?: string
  state?: string
}): Promise<Array<Experiment>> {
  const q = new URLSearchParams()
  if (params?.profile) q.set('profile', params.profile)
  if (params?.state) q.set('state', params.state)
  const qs = q.toString()
  const { experiments } = await apiFetch<ExperimentsResponse>(
    `/api/self-improve/experiments${qs ? `?${qs}` : ''}`,
  )
  return experiments
}

export async function fetchExperiment(id: number): Promise<Experiment> {
  return apiFetch<Experiment>(`/api/self-improve/experiments/${id}`)
}

export async function fetchExperimentHistory(id: number): Promise<ExperimentHistoryResponse> {
  return apiFetch<ExperimentHistoryResponse>(`/api/self-improve/experiments/${id}/history`)
}

export async function createExperiment(
  body: CreateExperimentBody,
): Promise<{ experiment_id: number }> {
  return apiFetch<{ experiment_id: number }>('/api/self-improve/experiments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function approveExperiment(
  id: number,
  actor: string,
): Promise<{ ok: boolean; state: string }> {
  return apiFetch<{ ok: boolean; state: string }>(`/api/self-improve/experiments/${id}/approve`, {
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
  return apiFetch<{ ok: boolean; state: string }>(`/api/self-improve/experiments/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor, reason }),
  })
}

export async function triggerPropose(
  profile: string,
): Promise<ProposeResponse | ProposeSkippedResponse> {
  return apiFetch<ProposeResponse | ProposeSkippedResponse>('/api/self-improve/propose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile }),
  })
}

// ── Lifecycle actions (P2) ────────────────────────────────────────────────────

export async function applyExperiment(
  id: number,
): Promise<{ ok: boolean; state: 'live'; apply_commit_sha: string }> {
  return apiFetch<{ ok: boolean; state: 'live'; apply_commit_sha: string }>(
    `/api/self-improve/experiments/${id}/apply`,
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
  return apiFetch<{ ok: boolean; state: 'verified' }>(
    `/api/self-improve/experiments/${id}/verify`,
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
  return apiFetch<{ ok: boolean; state: 'reverted' }>(
    `/api/self-improve/experiments/${id}/revert`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    },
  )
}

// ── P3: Scenarios ─────────────────────────────────────────────────────────────

export async function fetchScenarios(
  profile: string,
  includeHoldout = false,
): Promise<Array<Scenario>> {
  const q = new URLSearchParams()
  q.set('profile', profile)
  q.set('include_holdout', includeHoldout ? '1' : '0')
  const { scenarios } = await apiFetch<ScenariosResponse>(
    `/api/self-improve/scenarios?${q.toString()}`,
  )
  return scenarios
}

export async function createScenario(
  body: CreateScenarioBody,
): Promise<CreateScenarioResponse> {
  return apiFetch<CreateScenarioResponse>('/api/self-improve/scenarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteScenario(id: number): Promise<DeleteScenarioResponse> {
  return apiFetch<DeleteScenarioResponse>(`/api/self-improve/scenarios/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

// ── P3: Pause / Resume ────────────────────────────────────────────────────────

export async function pauseProfile(profile: string): Promise<PauseResumeResponse> {
  return apiFetch<PauseResumeResponse>(
    `/api/self-improve/profiles/${encodeURIComponent(profile)}/pause`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
}

export async function resumeProfile(profile: string): Promise<PauseResumeResponse> {
  return apiFetch<PauseResumeResponse>(
    `/api/self-improve/profiles/${encodeURIComponent(profile)}/resume`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
}
