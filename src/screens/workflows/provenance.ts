import type { WorkflowSource } from './types'

// ── Provenance types ──────────────────────────────────────────────────────────

export type Provenance = 'factory' | 'modified-factory' | 'user'

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  factory: 'Factory',
  'modified-factory': 'Modified factory',
  user: 'User',
}

/**
 * Feature flag: when true the "Modified factory" provenance state is
 * rendered. Gate keeps until the backend reliably emits `user_modified`.
 * Enable via VITE_WORKFLOW_PROVENANCE_V3=true in .env, or set
 * localStorage key "wfl_provenance_v3" to "true" at runtime.
 */
// Backend (workflow-engine plugin schema v5, live 2026-05-30) now emits
// `user_modified`, so the badge is ON by default. Set VITE_WORKFLOW_PROVENANCE_V3='false'
// or localStorage 'wfl_provenance_v3'='false' to force the legacy single-state badge.
export const WORKFLOW_PROVENANCE_V3: boolean =
  import.meta.env.VITE_WORKFLOW_PROVENANCE_V3 !== 'false' &&
  !(typeof localStorage !== 'undefined' &&
    localStorage.getItem('wfl_provenance_v3') === 'false')

/**
 * Derive the display provenance.
 *
 * When WORKFLOW_PROVENANCE_V3 is OFF (default), 'modified-factory' is
 * collapsed to 'factory' so the UI is visually identical to today.
 */
export function provenanceOf(
  source: WorkflowSource,
  userModified?: 0 | 1,
): Provenance {
  if (source !== 'bundled') return 'user'
  const raw: Provenance =
    WORKFLOW_PROVENANCE_V3 && userModified === 1 ? 'modified-factory' : 'factory'
  return raw
}
