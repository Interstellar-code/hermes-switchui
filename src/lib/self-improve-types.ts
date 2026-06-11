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
