import { describe, expect, it } from 'vitest'
import type {
  Experiment,
  ExperimentState,
  ProfileStatus,
} from '@/lib/self-improve-types'
import { computeNextStep } from '@/lib/self-improve-next-step'

function makeExperiment(
  state: ExperimentState,
  overrides: Partial<Experiment> = {},
): Experiment {
  return {
    id: 1,
    profile: 'default',
    file: 'a.ts',
    state,
    diff: '',
    rationale: '',
    offline_score: null,
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
    live_takes_effect_at_next_session: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeStatus(overrides: Partial<ProfileStatus> = {}): ProfileStatus {
  return {
    profile: 'default',
    paused: false,
    ...overrides,
  }
}

describe('computeNextStep', () => {
  it('bootstrap: configured === false wins over everything', () => {
    const step = computeNextStep({
      status: makeStatus({ configured: false }),
      hasMetrics: true,
      experiments: [makeExperiment('verified')],
    })
    expect(step.key).toBe('bootstrap')
  })

  it('add-training: fewer than 2 training scenarios', () => {
    const step = computeNextStep({
      status: makeStatus({
        configured: true,
        scenario_counts: { train: 1, holdout: 5 },
      }),
      hasMetrics: true,
      experiments: [],
    })
    expect(step.key).toBe('add-training')
  })

  it('add-holdout: no held-out scenarios', () => {
    const step = computeNextStep({
      status: makeStatus({
        configured: true,
        scenario_counts: { train: 5, holdout: 0 },
      }),
      hasMetrics: true,
      experiments: [],
    })
    expect(step.key).toBe('add-holdout')
  })

  it('collect: scenario counts satisfied but no metrics yet', () => {
    const step = computeNextStep({
      status: makeStatus({
        configured: true,
        scenario_counts: { train: 5, holdout: 2 },
      }),
      hasMetrics: false,
      experiments: [],
    })
    expect(step.key).toBe('collect')
  })

  it('propose: metrics exist, no proposed/approved/live experiment', () => {
    const step = computeNextStep({
      status: makeStatus({
        configured: true,
        scenario_counts: { train: 5, holdout: 2 },
      }),
      hasMetrics: true,
      experiments: [makeExperiment('rejected')],
    })
    expect(step.key).toBe('propose')
  })

  it('review: a proposed experiment exists', () => {
    const step = computeNextStep({
      status: makeStatus(),
      hasMetrics: true,
      experiments: [makeExperiment('proposed')],
    })
    expect(step.key).toBe('review')
  })

  it('apply: an approved experiment exists', () => {
    const step = computeNextStep({
      status: makeStatus(),
      hasMetrics: true,
      experiments: [makeExperiment('approved')],
    })
    expect(step.key).toBe('apply')
  })

  it('observe: a live experiment reports session progress', () => {
    const step = computeNextStep({
      status: makeStatus(),
      hasMetrics: true,
      experiments: [
        makeExperiment('live', {
          live_sessions_target: 10,
          live_sessions_observed: 3,
        }),
      ],
    })
    expect(step.key).toBe('observe')
    expect(step.hint).toContain('3/10')
  })

  it('observe: falls back to generic hint when session numbers unknown', () => {
    const step = computeNextStep({
      status: makeStatus(),
      hasMetrics: true,
      experiments: [makeExperiment('live', { live_sessions_target: null })],
    })
    expect(step.key).toBe('observe')
    expect(step.hint).toBe('Observing live sessions.')
  })

  it('baseline: a verified experiment exists but latest_baseline_score is missing', () => {
    const step = computeNextStep({
      status: makeStatus({ latest_baseline_score: null }),
      hasMetrics: true,
      experiments: [makeExperiment('verified')],
    })
    expect(step.key).toBe('baseline')
  })

  it('healthy: verified experiment and a baseline score already exist', () => {
    const step = computeNextStep({
      status: makeStatus({ latest_baseline_score: 0.9 }),
      hasMetrics: true,
      experiments: [makeExperiment('verified')],
    })
    expect(step.key).toBe('healthy')
  })

  it('degrades gracefully when all optional status fields are undefined', () => {
    expect(() =>
      computeNextStep({
        status: makeStatus(),
        hasMetrics: false,
        experiments: [],
      }),
    ).not.toThrow()

    const noMetrics = computeNextStep({
      status: makeStatus(),
      hasMetrics: false,
      experiments: [],
    })
    expect(noMetrics.key).toBe('collect')

    const withMetrics = computeNextStep({
      status: makeStatus(),
      hasMetrics: true,
      experiments: [],
    })
    expect(withMetrics.key).toBe('propose')
  })

  it('degrades gracefully when status itself is undefined', () => {
    expect(() =>
      computeNextStep({ status: undefined, hasMetrics: true, experiments: [] }),
    ).not.toThrow()
    const step = computeNextStep({
      status: undefined,
      hasMetrics: true,
      experiments: [],
    })
    expect(step.key).toBe('propose')
  })
})
