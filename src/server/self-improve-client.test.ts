import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyExperiment,
  approveExperiment,
  collectMetrics,
  createExperiment,
  createScenario,
  deleteScenario,
  getExperiment,
  getExperimentHistory,
  getHealth,
  getProfileStatus,
  latestMetrics,
  listBaselines,
  listExperiments,
  listMetrics,
  listScenarios,
  pauseProfile,
  proposeExperiment,
  rejectExperiment,
  resumeProfile,
  revertExperiment,
  verifyExperiment,
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
    const payload = {
      ok: true,
      plugin: 'karpathy-self-improve',
      version: '0.1.0',
      db_path: '/tmp/si.db',
      db_exists: true,
    }
    mockFetch.mockResolvedValue(jsonOk(payload))
    const result = await getHealth()
    expect(result).toEqual(payload)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/health'),
      expect.any(Object),
    )
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(
      errorResponse(503, { detail: 'Plugin offline' }),
    )
    await expect(getHealth()).rejects.toThrow('503')
  })
})

describe('listMetrics', () => {
  const snapshot = {
    id: 1,
    profile: 'default',
    captured_at: '2026-06-11T00:00:00Z',
    sessions_count: 5,
    error_count: 0,
    warn_count: 1,
    tokens: 1000,
    cost: 0.01,
    retries: 0,
    window_started_at: null,
    window_ended_at: null,
    from_offset: null,
    to_offset: null,
    payload: '{}',
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
    id: 1,
    profile: 'default',
    file: 'src/index.ts',
    commit_sha: 'abc123',
    score: 0.95,
    experiment_id: null,
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
    const result = await collectMetrics('prod')
    expect(result).toEqual(payload)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/metrics/collect'),
      expect.objectContaining({ method: 'POST', body: '{"profile":"prod"}' }),
    )
  })
})

describe('getProfileStatus', () => {
  it('returns paused state', async () => {
    mockFetch.mockResolvedValue(jsonOk({ profile: 'neo', paused: true }))
    await expect(getProfileStatus('neo')).resolves.toEqual({
      profile: 'neo',
      paused: true,
    })
  })
})

// ── Experiments ────────────────────────────────────────────────────────────────

const baseExp = {
  id: 1,
  profile: 'default',
  file: 'src/index.ts',
  state: 'proposed' as const,
  diff: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new',
  rationale: 'improve quality',
  offline_score: 0.85,
  proposer_model: 'claude-3-haiku',
  judge_model: 'claude-3-sonnet',
  created_at: '2026-06-11T00:00:00Z',
}

describe('listExperiments', () => {
  it('returns experiments array on success', async () => {
    mockFetch.mockResolvedValue(jsonOk({ experiments: [baseExp] }))
    const result = await listExperiments()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/experiments'),
      expect.any(Object),
    )
  })

  it('passes state query param when provided', async () => {
    mockFetch.mockResolvedValue(jsonOk({ experiments: [] }))
    await listExperiments({ state: 'proposed' })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('state=proposed'),
      expect.any(Object),
    )
  })

  it('passes profile query param when provided', async () => {
    mockFetch.mockResolvedValue(jsonOk({ experiments: [] }))
    await listExperiments({ profile: 'myprofile' })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('profile=myprofile'),
      expect.any(Object),
    )
  })

  it('throws on error response', async () => {
    mockFetch.mockResolvedValue(
      errorResponse(503, { detail: 'Plugin unavailable' }),
    )
    await expect(listExperiments()).rejects.toThrow()
  })
})

describe('getExperiment', () => {
  it('returns the experiment on success', async () => {
    mockFetch.mockResolvedValue(jsonOk(baseExp))
    const result = await getExperiment(1)
    expect(result.id).toBe(1)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/experiments/1'),
      expect.any(Object),
    )
  })

  it('throws on 404', async () => {
    mockFetch.mockResolvedValue(errorResponse(404, { detail: 'Not found' }))
    await expect(getExperiment(999)).rejects.toThrow()
  })
})

describe('getExperimentHistory', () => {
  it('returns experiment history on success', async () => {
    const payload = {
      experiment: baseExp,
      transitions: [],
      eval_runs: [],
      scenario_results: [],
    }
    mockFetch.mockResolvedValue(jsonOk(payload))
    const result = await getExperimentHistory(1)
    expect(result.experiment.id).toBe(1)
    expect(result.eval_runs).toEqual([])
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/experiments/1/history'),
      expect.any(Object),
    )
  })

  it('throws on error response', async () => {
    mockFetch.mockResolvedValue(
      errorResponse(503, { detail: 'Plugin unavailable' }),
    )
    await expect(getExperimentHistory(1)).rejects.toThrow()
  })
})

describe('createExperiment', () => {
  it('POSTs body and returns experiment_id on success', async () => {
    mockFetch.mockResolvedValue(jsonOk({ experiment_id: 42 }))
    const result = await createExperiment({
      profile: 'default',
      diff: 'diff text',
      rationale: 'why',
    })
    expect(result.experiment_id).toBe(42)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/experiments'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"profile":"default"'),
      }),
    )
  })

  it('throws on 422 validation error', async () => {
    mockFetch.mockResolvedValue(errorResponse(422, { detail: 'Invalid body' }))
    await expect(createExperiment({ profile: 'x' })).rejects.toThrow()
  })
})

describe('approveExperiment', () => {
  it('POSTs to approve endpoint with actor', async () => {
    mockFetch.mockResolvedValue(jsonOk({ ok: true, state: 'approved' }))
    const result = await approveExperiment(1, 'switchui-user')
    expect(result.ok).toBe(true)
    expect(result.state).toBe('approved')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/experiments/1/approve'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"actor":"switchui-user"'),
      }),
    )
  })

  it('throws on error response', async () => {
    mockFetch.mockResolvedValue(errorResponse(404, { detail: 'Not found' }))
    await expect(approveExperiment(999, 'actor')).rejects.toThrow()
  })
})

describe('rejectExperiment', () => {
  it('POSTs to reject endpoint with actor and reason', async () => {
    mockFetch.mockResolvedValue(jsonOk({ ok: true, state: 'rejected' }))
    const result = await rejectExperiment(1, 'switchui-user', 'not good enough')
    expect(result.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/experiments/1/reject'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"reason":"not good enough"'),
      }),
    )
  })

  it('throws on error response', async () => {
    mockFetch.mockResolvedValue(errorResponse(503, { detail: 'Plugin down' }))
    await expect(rejectExperiment(1, 'actor', 'reason')).rejects.toThrow()
  })
})

describe('proposeExperiment', () => {
  it('POSTs to propose endpoint and returns ProposeResponse', async () => {
    mockFetch.mockResolvedValue(
      jsonOk({ experiment_id: 7, offline_score: 0.9 }),
    )
    const result = await proposeExperiment('default')
    expect(result).toMatchObject({ experiment_id: 7, offline_score: 0.9 })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/propose'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"profile":"default"'),
      }),
    )
  })

  it('returns skipped response when agent skips', async () => {
    mockFetch.mockResolvedValue(
      jsonOk({ skipped: true, reason: 'no new data' }),
    )
    const result = await proposeExperiment('default')
    expect(result).toMatchObject({ skipped: true, reason: 'no new data' })
  })

  it('throws on error response', async () => {
    mockFetch.mockResolvedValue(errorResponse(503, { detail: 'Plugin down' }))
    await expect(proposeExperiment('default')).rejects.toThrow()
  })
})

// ── P2 lifecycle actions ──────────────────────────────────────────────────────

describe('applyExperiment', () => {
  it('POSTs to apply endpoint and returns ok + state + sha', async () => {
    mockFetch.mockResolvedValue(
      jsonOk({ ok: true, state: 'live', apply_commit_sha: 'abc1234' }),
    )
    const result = await applyExperiment(5)
    expect(result.ok).toBe(true)
    expect(result.state).toBe('live')
    expect(result.apply_commit_sha).toBe('abc1234')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/experiments/5/apply'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws on error response', async () => {
    mockFetch.mockResolvedValue(errorResponse(422, { detail: 'Invalid state' }))
    await expect(applyExperiment(5)).rejects.toThrow('422')
  })

  it('throws on 503', async () => {
    mockFetch.mockResolvedValue(errorResponse(503, { detail: 'Plugin down' }))
    await expect(applyExperiment(5)).rejects.toThrow()
  })
})

describe('verifyExperiment', () => {
  it('POSTs to verify endpoint and returns ok + state', async () => {
    mockFetch.mockResolvedValue(jsonOk({ ok: true, state: 'verified' }))
    const result = await verifyExperiment(3)
    expect(result.ok).toBe(true)
    expect(result.state).toBe('verified')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/experiments/3/verify'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws on error response', async () => {
    mockFetch.mockResolvedValue(errorResponse(404, { detail: 'Not found' }))
    await expect(verifyExperiment(3)).rejects.toThrow()
  })
})

describe('revertExperiment', () => {
  it('POSTs to revert endpoint with reason in body', async () => {
    mockFetch.mockResolvedValue(jsonOk({ ok: true, state: 'reverted' }))
    const result = await revertExperiment(7, 'regression detected')
    expect(result.ok).toBe(true)
    expect(result.state).toBe('reverted')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/experiments/7/revert'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"reason":"regression detected"'),
      }),
    )
  })

  it('sends empty reason when not provided', async () => {
    mockFetch.mockResolvedValue(jsonOk({ ok: true, state: 'reverted' }))
    await revertExperiment(7, '')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/experiments/7/revert'),
      expect.objectContaining({
        body: expect.stringContaining('"reason":""'),
      }),
    )
  })

  it('throws on error response', async () => {
    mockFetch.mockResolvedValue(errorResponse(503, { detail: 'Plugin down' }))
    await expect(revertExperiment(7, 'reason')).rejects.toThrow()
  })
})

// ── P3: listScenarios ─────────────────────────────────────────────────────────

describe('listScenarios', () => {
  it('GETs /scenarios with profile param always set', async () => {
    mockFetch.mockResolvedValue(jsonOk({ scenarios: [] }))
    const result = await listScenarios('default')
    expect(result).toEqual([])
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/scenarios\?.*profile=default/),
      expect.anything(),
    )
  })

  it('passes include_holdout=0 by default', async () => {
    mockFetch.mockResolvedValue(jsonOk({ scenarios: [] }))
    await listScenarios('myprofile')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('include_holdout=0'),
      expect.anything(),
    )
  })

  it('passes include_holdout=1 when requested', async () => {
    mockFetch.mockResolvedValue(jsonOk({ scenarios: [] }))
    await listScenarios('myprofile', true)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('include_holdout=1'),
      expect.anything(),
    )
  })

  it('returns scenario array from response', async () => {
    const scenario = {
      id: 1,
      profile: 'default',
      name: 'test',
      input: 'hi',
      checks: '[]',
      holdout: 0,
      created_at: '2026-01-01T00:00:00Z',
    }
    mockFetch.mockResolvedValue(jsonOk({ scenarios: [scenario] }))
    const result = await listScenarios('default')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('test')
  })

  it('throws on error response', async () => {
    mockFetch.mockResolvedValue(errorResponse(503, { detail: 'Plugin down' }))
    await expect(listScenarios('default')).rejects.toThrow()
  })
})

// ── P3: createScenario ────────────────────────────────────────────────────────

describe('createScenario', () => {
  it('POSTs to /scenarios with required fields', async () => {
    mockFetch.mockResolvedValue(jsonOk({ scenario_id: 42 }))
    const result = await createScenario({
      profile: 'default',
      name: 'greeting',
    })
    expect(result.scenario_id).toBe(42)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/scenarios'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"profile":"default"'),
      }),
    )
  })

  it('includes checks array in body when provided', async () => {
    mockFetch.mockResolvedValue(jsonOk({ scenario_id: 7 }))
    await createScenario({
      profile: 'p',
      name: 'n',
      checks: ['check1', 'check2'],
    })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining('"checks"'),
      }),
    )
  })

  it('throws on 422 validation error', async () => {
    mockFetch.mockResolvedValue(errorResponse(422, { detail: 'Invalid body' }))
    await expect(createScenario({ profile: 'p', name: 'n' })).rejects.toThrow()
  })
})

// ── P3: deleteScenario ────────────────────────────────────────────────────────

describe('deleteScenario', () => {
  it('DELETEs /scenarios/{id}', async () => {
    mockFetch.mockResolvedValue(jsonOk({ ok: true }))
    const result = await deleteScenario(5)
    expect(result.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/scenarios/5'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('throws on 404', async () => {
    mockFetch.mockResolvedValue(errorResponse(404, { detail: 'Not found' }))
    await expect(deleteScenario(99)).rejects.toThrow()
  })

  it('throws on 503', async () => {
    mockFetch.mockResolvedValue(errorResponse(503, { detail: 'Plugin down' }))
    await expect(deleteScenario(1)).rejects.toThrow()
  })
})

// ── P3: pauseProfile ──────────────────────────────────────────────────────────

describe('pauseProfile', () => {
  it('POSTs to /profiles/{profile}/pause and returns paused=true', async () => {
    mockFetch.mockResolvedValue(
      jsonOk({ ok: true, profile: 'default', paused: true }),
    )
    const result = await pauseProfile('default')
    expect(result.ok).toBe(true)
    expect(result.paused).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/profiles/default/pause'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('URL-encodes profile name', async () => {
    mockFetch.mockResolvedValue(
      jsonOk({ ok: true, profile: 'my profile', paused: true }),
    )
    await pauseProfile('my profile')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/profiles/my%20profile/pause'),
      expect.anything(),
    )
  })

  it('throws on error response', async () => {
    mockFetch.mockResolvedValue(errorResponse(503, { detail: 'Plugin down' }))
    await expect(pauseProfile('default')).rejects.toThrow()
  })
})

// ── P3: resumeProfile ─────────────────────────────────────────────────────────

describe('resumeProfile', () => {
  it('POSTs to /profiles/{profile}/resume and returns paused=false', async () => {
    mockFetch.mockResolvedValue(
      jsonOk({ ok: true, profile: 'default', paused: false }),
    )
    const result = await resumeProfile('default')
    expect(result.ok).toBe(true)
    expect(result.paused).toBe(false)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/profiles/default/resume'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws on error response', async () => {
    mockFetch.mockResolvedValue(errorResponse(503, { detail: 'Plugin down' }))
    await expect(resumeProfile('default')).rejects.toThrow()
  })
})
