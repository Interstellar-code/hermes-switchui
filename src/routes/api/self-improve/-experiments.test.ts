/**
 * Route handler tests for /api/self-improve/experiments* routes.
 * Mirrors the hermes-kanban/-boards.test.ts pattern.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../../server/auth-middleware'
import {
  approveExperiment,
  createExperiment,
  listExperiments,
} from '../../../server/self-improve-client'
import { Route as ExperimentsRoute } from './experiments'
import { Route as ApproveRoute } from './experiments.$id.approve'

// ── Mocks (must be hoisted before imports) ────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (options: unknown) => ({ path, options }),
}))

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../../server/rate-limit', () => ({
  requireJsonContentType: vi.fn().mockReturnValue(null),
}))

vi.mock('../../../server/self-improve-client', () => ({
  listExperiments: vi.fn(),
  createExperiment: vi.fn(),
  approveExperiment: vi.fn(),
  rejectExperiment: vi.fn(),
  proposeExperiment: vi.fn(),
}))

const experimentsHandlers = (ExperimentsRoute as any).options.server.handlers
const approveHandlers = (ApproveRoute as any).options.server.handlers

const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockListExperiments = vi.mocked(listExperiments)
const mockCreateExperiment = vi.mocked(createExperiment)
const mockApproveExperiment = vi.mocked(approveExperiment)

function makeRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const baseExp = {
  id: 1,
  profile: 'default',
  file: 'src/index.ts',
  state: 'proposed' as const,
  diff: '+new line',
  rationale: 'improve',
  offline_score: 0.9,
  live_score: null,
  verdict: null,
  cost: 0,
  approved_by: null,
  approved_at: null,
  rejected_by: null,
  rejected_at: null,
  rejection_reason: null,
  live_sessions_target: null,
  live_sessions_observed: 0,
  applied_at: null,
  verified_at: null,
  reverted_at: null,
  base_commit_sha: null,
  apply_commit_sha: null,
  revert_commit_sha: null,
  proposer_model: null,
  judge_model: null,
  sentence_delta_count: null,
  baseline_id: null,
  created_at: '2026-06-11T00:00:00Z',
  updated_at: '2026-06-11T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsAuthenticated.mockReturnValue(true)
})

// ── GET /api/self-improve/experiments ─────────────────────────────────────────

describe('GET /api/self-improve/experiments', () => {
  it('returns 401 when not authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const res = await experimentsHandlers.GET({
      request: makeRequest('GET', 'http://localhost/api/self-improve/experiments'),
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns experiments list on success', async () => {
    mockListExperiments.mockResolvedValue([baseExp])
    const res = await experimentsHandlers.GET({
      request: makeRequest('GET', 'http://localhost/api/self-improve/experiments'),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.experiments).toHaveLength(1)
    expect(body.experiments[0].id).toBe(1)
  })

  it('passes state query param to client', async () => {
    mockListExperiments.mockResolvedValue([])
    const res = await experimentsHandlers.GET({
      request: makeRequest('GET', 'http://localhost/api/self-improve/experiments?state=proposed'),
    })
    expect(res.status).toBe(200)
    expect(mockListExperiments).toHaveBeenCalledWith({ profile: undefined, state: 'proposed' })
  })

  it('returns 503 when client throws', async () => {
    mockListExperiments.mockRejectedValue(new Error('Self-Improve plugin unavailable'))
    const res = await experimentsHandlers.GET({
      request: makeRequest('GET', 'http://localhost/api/self-improve/experiments'),
    })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('unavailable')
  })
})

// ── POST /api/self-improve/experiments ───────────────────────────────────────

describe('POST /api/self-improve/experiments', () => {
  it('returns 401 when not authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const res = await experimentsHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments', {
        profile: 'default',
        diff: '+line',
      }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 201 with experiment_id on success', async () => {
    mockCreateExperiment.mockResolvedValue({ experiment_id: 42 })
    const res = await experimentsHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments', {
        profile: 'default',
        diff: '+line',
        rationale: 'test',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.experiment_id).toBe(42)
  })

  it('returns 503 when client throws', async () => {
    mockCreateExperiment.mockRejectedValue(new Error('Self-Improve plugin unavailable'))
    const res = await experimentsHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments', {
        profile: 'default',
      }),
    })
    expect(res.status).toBe(503)
  })
})

// ── POST /api/self-improve/experiments/$id/approve ───────────────────────────

describe('POST /api/self-improve/experiments/$id/approve', () => {
  it('returns 401 when not authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const res = await approveHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/1/approve', {
        actor: 'switchui-user',
      }),
      params: { id: '1' },
    })
    expect(res.status).toBe(401)
  })

  it('approves experiment and returns ok on success', async () => {
    mockApproveExperiment.mockResolvedValue({ ok: true, state: 'approved' })
    const res = await approveHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/1/approve', {
        actor: 'switchui-user',
      }),
      params: { id: '1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.state).toBe('approved')
    expect(mockApproveExperiment).toHaveBeenCalledWith(1, 'switchui-user')
  })

  it('uses default actor when none provided', async () => {
    mockApproveExperiment.mockResolvedValue({ ok: true, state: 'approved' })
    await approveHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/1/approve', {}),
      params: { id: '1' },
    })
    expect(mockApproveExperiment).toHaveBeenCalledWith(1, 'switchui-user')
  })

  it('returns 503 when client throws', async () => {
    mockApproveExperiment.mockRejectedValue(new Error('Self-Improve plugin unavailable'))
    const res = await approveHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/1/approve', {
        actor: 'switchui-user',
      }),
      params: { id: '1' },
    })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  it('returns 404 when experiment not found', async () => {
    mockApproveExperiment.mockRejectedValue(new Error('404 not found'))
    const res = await approveHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/999/approve', {
        actor: 'switchui-user',
      }),
      params: { id: '999' },
    })
    expect(res.status).toBe(404)
  })
})
