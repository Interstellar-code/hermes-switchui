/**
 * Type definitions for the karpathy-self-improve plugin.
 * Field names must match the plugin REST API exactly — do not rename.
 */

export interface MetricsSnapshot {
  id: number
  profile: string
  captured_at: string // ISO timestamp
  sessions_count: number
  error_count: number
  warn_count: number
  tokens: number
  cost: number
  retries: number
  window_started_at: string | null
  window_ended_at: string | null
  from_offset: number | null
  to_offset: number | null
  payload: string // JSON-encoded
}

export interface Baseline {
  id: number
  profile: string
  file: string
  commit_sha: string | null
  score: number | null
  experiment_id: number | null
  created_at: string // ISO timestamp
}

export interface PluginHealth {
  ok: boolean
  plugin: string
  version: string
  db_path: string | null
  db_exists: boolean
}

// ── Experiments ───────────────────────────────────────────────────────────────

export type ExperimentState =
  | 'proposed'
  | 'approved'
  | 'live'
  | 'verified'
  | 'reverted'
  | 'rejected'

export interface Experiment {
  id: number
  profile: string
  file: string
  state: ExperimentState
  diff: string
  rationale: string
  offline_score: number | null
  live_score: number | null
  verdict: string | null
  cost: number
  approved_by: string | null
  approved_at: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string | null
  live_sessions_target: number | null
  live_sessions_observed: number
  applied_at: string | null
  verified_at: string | null
  reverted_at: string | null
  base_commit_sha: string | null
  apply_commit_sha: string | null
  revert_commit_sha: string | null
  proposer_model: string | null
  judge_model: string | null
  sentence_delta_count: number | null
  baseline_id: number | null
  created_at: string
  updated_at: string
}

export interface Transition {
  id: number
  experiment_id: number
  from_state: string | null
  to_state: string
  actor: string | null
  reason: string | null
  created_at: string
}

export interface EvalRun {
  id: number
  experiment_id: number
  kind: 'offline' | 'live'
  proposer_model: string | null
  judge_model: string | null
  aggregate_score: number | null
  cost: number | null
  created_at: string
}

export interface ScenarioResult {
  id: number
  eval_run_id: number
  scenario_id: number
  split: 'train' | 'holdout'
  pass_fail: 0 | 1
  judge_rationale: string
  scenario_snapshot: string // JSON-encoded
  created_at: string
}

// ── Response wrappers ─────────────────────────────────────────────────────────

export interface MetricsResponse {
  metrics: Array<MetricsSnapshot>
}

export interface BaselinesResponse {
  baselines: Array<Baseline>
}

export interface CollectResponse {
  collected: number
  snapshots: Array<MetricsSnapshot>
}

export interface ExperimentsResponse {
  experiments: Array<Experiment>
}

export interface ExperimentHistoryResponse {
  experiment: Experiment
  transitions: Array<Transition>
  eval_runs: Array<EvalRun>
  scenario_results: Array<ScenarioResult>
}

export interface CreateExperimentBody {
  profile: string
  file?: string
  diff?: string
  rationale?: string
}

export interface ProposeResponse {
  experiment_id: number
  offline_score: number
}

export interface ProposeSkippedResponse {
  skipped: true
  reason: string
}

// ── P3: Scenarios ─────────────────────────────────────────────────────────────

export interface Scenario {
  id: number
  profile: string
  name: string
  input: string
  checks: string // JSON-encoded array
  holdout: 0 | 1
  created_at: string
}

export interface ScenariosResponse {
  scenarios: Array<Scenario>
}

export interface CreateScenarioBody {
  profile: string
  name: string
  input?: string
  checks?: Array<string> | string
  holdout?: boolean
}

export interface CreateScenarioResponse {
  scenario_id: number
}

export interface DeleteScenarioResponse {
  ok: true
}

// ── P3: Pause / Resume ────────────────────────────────────────────────────────

export interface PauseResumeResponse {
  ok: boolean
  profile: string
  paused: boolean
}
