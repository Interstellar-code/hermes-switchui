/**
 * Pure mapping from self-improve profile state to the single "next step" the
 * user should take. Drives a summary line and empty-state hints. No React,
 * no UI imports.
 */
import type { Experiment, ProfileStatus } from '@/lib/self-improve-types'

export interface NextStep {
  /** short imperative label, e.g. "Add held-out scenarios" */
  label: string
  /** one-sentence why/what, e.g. "Held-out scenarios verify the change generalizes." */
  hint: string
  /** stable key for tests/conditionals */
  key:
    | 'bootstrap'
    | 'add-training'
    | 'add-holdout'
    | 'collect'
    | 'propose'
    | 'review'
    | 'apply'
    | 'observe'
    | 'verify'
    | 'baseline'
    | 'healthy'
}

export interface NextStepInput {
  status: ProfileStatus | undefined
  hasMetrics: boolean
  experiments: ReadonlyArray<Experiment>
}

export function computeNextStep(input: NextStepInput): NextStep {
  const { status, hasMetrics, experiments } = input

  if (status?.configured === false) {
    return {
      key: 'bootstrap',
      label: 'Bootstrap profile',
      hint: 'Run: hermes --profile <name> karpathy bootstrap so it has a target file.',
    }
  }

  const counts = status?.scenario_counts
  if (counts && counts.train < 2) {
    return {
      key: 'add-training',
      label: 'Add training scenarios',
      hint: 'Training scenarios teach the profile what to measure.',
    }
  }
  if (counts && counts.holdout < 1) {
    return {
      key: 'add-holdout',
      label: 'Add held-out scenarios',
      hint: 'Held-out scenarios verify the change generalizes and guard against overfitting.',
    }
  }

  if (!hasMetrics) {
    return {
      key: 'collect',
      label: 'Collect a metrics snapshot',
      hint: 'Collect a first metrics snapshot to establish a baseline of activity.',
    }
  }

  const live = experiments.find((e) => e.state === 'live')
  const proposed = experiments.find((e) => e.state === 'proposed')
  const approved = experiments.find((e) => e.state === 'approved')
  const verified = experiments.find((e) => e.state === 'verified')

  if (!proposed && !approved && !live && !verified) {
    return {
      key: 'propose',
      label: 'Propose a change',
      hint: 'Propose the first change based on collected metrics.',
    }
  }

  if (proposed) {
    return {
      key: 'review',
      label: 'Review the proposal',
      hint: 'Review the diff before approving it.',
    }
  }

  if (approved) {
    return {
      key: 'apply',
      label: 'Apply the change',
      hint: 'Apply the approved experiment to start observing live sessions.',
    }
  }

  if (live) {
    const target = live.live_sessions_target
    const observed = live.live_sessions_observed
    const hint =
      target != null
        ? `Observing ${observed}/${target} live sessions.`
        : 'Observing live sessions.'
    return {
      key: 'observe',
      label: 'Observe live sessions',
      hint,
    }
  }

  if (verified && (status?.latest_baseline_score ?? null) == null) {
    return {
      key: 'baseline',
      label: 'Verify to write baseline',
      hint: 'Verify writes the baseline score used to judge future changes.',
    }
  }

  return {
    key: 'healthy',
    label: 'Loop healthy',
    hint: 'Loop healthy — monitor.',
  }
}
