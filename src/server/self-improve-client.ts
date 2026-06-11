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
  MetricsResponse,
  MetricsSnapshot,
  PluginHealth,
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
