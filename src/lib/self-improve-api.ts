/**
 * Browser-side fetch client for the /api/self-improve/* proxy routes.
 * This module is safe to import in client components.
 */
import type {
  Baseline,
  BaselinesResponse,
  CollectResponse,
  MetricsResponse,
  MetricsSnapshot,
  PluginHealth,
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
