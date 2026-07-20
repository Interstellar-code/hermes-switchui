/**
 * Route handler tests for /api/self-improve/experiments* routes.
 * Mirrors the hermes-kanban/-boards.test.ts pattern.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../../server/auth-middleware'
import {
  applyExperiment,
  approveExperiment,
  createExperiment,
  listExperiments,
  revertExperiment,
  verifyExperiment,
} from '../../../server/self-improve-client'
import { Route as ExperimentsRoute } from './experiments'
import { Route as ApproveRoute } from './experiments.$id.approve'
import { Route as ApplyRoute } from './experiments.$id.apply'
import { Route as VerifyRoute } from './experiments.$id.verify'
import { Route as RevertRoute } from './experiments.$id.revert'

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
  applyExperiment: vi.fn(),
  verifyExperiment: vi.fn(),
  revertExperiment: vi.fn(),
}))

const experimentsHandlers = (ExperimentsRoute as any).options.server.handlers
const approveHandlers = (ApproveRoute as any).options.server.handlers
const applyHandlers = (ApplyRoute as any).options.server.handlers
const verifyHandlers = (VerifyRoute as any).options.server.handlers
const revertHandlers = (RevertRoute as any).options.server.handlers

const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockListExperiments = vi.mocked(listExperiments)
const mockCreateExperiment = vi.mocked(createExperiment)
const mockApproveExperiment = vi.mocked(approveExperiment)
const mockApplyExperiment = vi.mocked(applyExperiment)
const mockVerifyExperiment = vi.mocked(verifyExperiment)
const mockRevertExperiment = vi.mocked(revertExperiment)

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
  target_relpath: null,
  target_profile_root: null,
  live_takes_effect_at_next_session: 1,
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

// ── POST /api/self-improve/experiments/$id/apply ──────────────────────────────

describe('POST /api/self-improve/experiments/$id/apply', () => {
  it('returns 401 when not authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const res = await applyHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/1/apply', {}),
      params: { id: '1' },
    })
    expect(res.status).toBe(401)
  })

  it('applies experiment and returns ok + state + sha on success', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockApplyExperiment.mockResolvedValue({ ok: true, state: 'live', apply_commit_sha: 'abc1234' })
    const res = await applyHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/1/apply', {}),
      params: { id: '1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.state).toBe('live')
    expect(body.apply_commit_sha).toBe('abc1234')
    expect(mockApplyExperiment).toHaveBeenCalledWith(1)
  })

  it('returns 422 when client throws 422 error', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockApplyExperiment.mockRejectedValue(new Error('422 invalid state transition'))
    const res = await applyHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/1/apply', {}),
      params: { id: '1' },
    })
    expect(res.status).toBe(422)
  })

  it('returns 503 when client throws generic error', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockApplyExperiment.mockRejectedValue(new Error('Self-Improve plugin unavailable'))
    const res = await applyHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/1/apply', {}),
      params: { id: '1' },
    })
    expect(res.status).toBe(503)
  })

  it('returns 400 for invalid experiment id', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    const res = await applyHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/bad/apply', {}),
      params: { id: 'bad' },
    })
    expect(res.status).toBe(400)
  })
})

// ── POST /api/self-improve/experiments/$id/verify ─────────────────────────────

describe('POST /api/self-improve/experiments/$id/verify', () => {
  it('returns 401 when not authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const res = await verifyHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/2/verify', {}),
      params: { id: '2' },
    })
    expect(res.status).toBe(401)
  })

  it('verifies experiment on success', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockVerifyExperiment.mockResolvedValue({ ok: true, state: 'verified' })
    const res = await verifyHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/2/verify', {}),
      params: { id: '2' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.state).toBe('verified')
    expect(mockVerifyExperiment).toHaveBeenCalledWith(2)
  })
})

// ── POST /api/self-improve/experiments/$id/revert ─────────────────────────────

describe('POST /api/self-improve/experiments/$id/revert', () => {
  it('returns 401 when not authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const res = await revertHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/3/revert', { reason: 'bad' }),
      params: { id: '3' },
    })
    expect(res.status).toBe(401)
  })

  it('reverts experiment and passes reason from body', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockRevertExperiment.mockResolvedValue({ ok: true, state: 'reverted' })
    const res = await revertHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/3/revert', {
        reason: 'regression detected',
      }),
      params: { id: '3' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.state).toBe('reverted')
    expect(mockRevertExperiment).toHaveBeenCalledWith(3, 'regression detected')
  })

  it('uses empty reason when not provided in body', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockRevertExperiment.mockResolvedValue({ ok: true, state: 'reverted' })
    await revertHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/3/revert', {}),
      params: { id: '3' },
    })
    expect(mockRevertExperiment).toHaveBeenCalledWith(3, '')
  })

  it('returns 503 when client throws', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockRevertExperiment.mockRejectedValue(new Error('Self-Improve plugin unavailable'))
    const res = await revertHandlers.POST({
      request: makeRequest('POST', 'http://localhost/api/self-improve/experiments/3/revert', { reason: 'x' }),
      params: { id: '3' },
    })
    expect(res.status).toBe(503)
  })
})
