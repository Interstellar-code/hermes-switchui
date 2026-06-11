import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectMetrics,
  getHealth,
  latestMetrics,
  listBaselines,
  listMetrics,
} from './self-improve-client'

import { dashboardFetch } from './gateway-capabilities'

// Mock dashboardFetch so tests never hit the network
vi.mock('./gateway-capabilities', () => ({
  dashboardFetch: vi.fn(),
}))
const mockFetch = vi.mocked(dashboardFetch)

function jsonOk(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getHealth', () => {
  it('returns parsed PluginHealth on success', async () => {
    const payload = { ok: true, plugin: 'karpathy-self-improve', version: '0.1.0', db_path: '/tmp/si.db', db_exists: true }
    mockFetch.mockResolvedValue(jsonOk(payload))
    const result = await getHealth()
    expect(result).toEqual(payload)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/health'),
      expect.any(Object),
    )
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(errorResponse(503, { detail: 'Plugin offline' }))
    await expect(getHealth()).rejects.toThrow('503')
  })
})

describe('listMetrics', () => {
  const snapshot = {
    id: 1, profile: 'default', captured_at: '2026-06-11T00:00:00Z',
    sessions_count: 5, error_count: 0, warn_count: 1,
    tokens: 1000, cost: 0.01, retries: 0,
    window_started_at: null, window_ended_at: null,
    from_offset: null, to_offset: null, payload: '{}',
  }

  it('returns metrics array', async () => {
    mockFetch.mockResolvedValue(jsonOk({ metrics: [snapshot] }))
    const result = await listMetrics()
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(snapshot)
  })

  it('forwards profile and limit as query params', async () => {
    mockFetch.mockResolvedValue(jsonOk({ metrics: [] }))
    await listMetrics({ profile: 'prod', limit: 10 })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('profile=prod'),
      expect.any(Object),
    )
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=10'),
      expect.any(Object),
    )
  })
})

describe('latestMetrics', () => {
  it('returns metrics array from /metrics/latest', async () => {
    mockFetch.mockResolvedValue(jsonOk({ metrics: [] }))
    const result = await latestMetrics()
    expect(result).toEqual([])
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/metrics/latest'),
      expect.any(Object),
    )
  })
})

describe('listBaselines', () => {
  const baseline = {
    id: 1, profile: 'default', file: 'src/index.ts',
    commit_sha: 'abc123', score: 0.95, experiment_id: null,
    created_at: '2026-06-11T00:00:00Z',
  }

  it('returns baselines array', async () => {
    mockFetch.mockResolvedValue(jsonOk({ baselines: [baseline] }))
    const result = await listBaselines()
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(baseline)
  })

  it('forwards profile as query param when provided', async () => {
    mockFetch.mockResolvedValue(jsonOk({ baselines: [] }))
    await listBaselines({ profile: 'staging' })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('profile=staging'),
      expect.any(Object),
    )
  })
})

describe('collectMetrics', () => {
  it('POSTs and returns CollectResponse', async () => {
    const payload = { collected: 3, snapshots: [] }
    mockFetch.mockResolvedValue(jsonOk(payload))
    const result = await collectMetrics()
    expect(result).toEqual(payload)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/metrics/collect'),
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
