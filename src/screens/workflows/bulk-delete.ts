/**
 * bulk-delete.ts — F8 bulk delete/reset planning + execution (pure-ish).
 *
 * User decisions (user go 2026-10-07 10:35): hard delete through the
 * existing routes; user AND project rows delete; factory rows reset (only
 * when opted in); rows with an active run fail server-side (409) and are reported.
 * Calls run sequentially through the existing clients — no retries, no new
 * endpoints, and no result is claimed before the server answered.
 */
import {
  deleteWorkflowDefinition,
  resetWorkflowDefinitionToFactory,
} from './api-client'
import type { WorkflowSummary } from './types'

export type BulkOutcome = 'deleted' | 'reset' | 'failed'

export interface BulkRowResult {
  id: string
  name: string
  outcome: BulkOutcome
  /** Failed rows only: the server's message, verbatim. */
  message?: string
}

export interface BulkSummary {
  deleted: number
  reset: number
  failed: number
  results: Array<BulkRowResult>
}

export interface BulkPlan {
  toDelete: Array<WorkflowSummary>
  toReset: Array<WorkflowSummary>
  /** Factory rows left alone because reset was not opted in. */
  skipped: Array<WorkflowSummary>
}

/** Split a selection into per-row actions. Never mutates the input. */
export function planBulkDelete(
  selected: Array<WorkflowSummary>,
  resetFactory: boolean,
): BulkPlan {
  const toDelete: Array<WorkflowSummary> = []
  const toReset: Array<WorkflowSummary> = []
  const skipped: Array<WorkflowSummary> = []
  for (const wf of selected) {
    // Widened to string: the type union is closed today, but the runtime
    // guard must still hold if a new source ever appears (F8 review LOW).
    const source: string = wf.source
    if (source === 'user' || source === 'project') {
      toDelete.push(wf)
    } else if (source === 'bundled') {
      ;(resetFactory ? toReset : skipped).push(wf)
    } else {
      skipped.push(wf)
    }
  }
  return { toDelete, toReset, skipped }
}

/**
 * Run the plan: deletes first, then resets, one row at a time. The route's
 * active-run 409, 403 on bundled and 404 all land as `failed` with the
 * server's message verbatim (or "Skipped — has an active run" on 409). A
 * failed row never stops the run and is never retried. `isAborted` is
 * checked before each row (the dialog unmounted mid-run): remaining rows are
 * dropped and the results so far are returned.
 */
export async function executeBulkDelete(
  plan: BulkPlan,
  opts: { isAborted?: () => boolean } = {},
): Promise<BulkSummary> {
  const results: Array<BulkRowResult> = []

  for (const wf of plan.toDelete) {
    if (opts.isAborted?.()) return summarise(results)
    try {
      await deleteWorkflowDefinition(wf.id)
      results.push({ id: wf.id, name: wf.name, outcome: 'deleted' })
    } catch (err) {
      results.push(failedResult(wf, err, 'Delete failed'))
    }
  }

  for (const wf of plan.toReset) {
    if (opts.isAborted?.()) return summarise(results)
    try {
      await resetWorkflowDefinitionToFactory(wf.id)
      results.push({ id: wf.id, name: wf.name, outcome: 'reset' })
    } catch (err) {
      results.push(failedResult(wf, err, 'Reset failed'))
    }
  }

  return summarise(results)
}

function failedResult(
  wf: WorkflowSummary,
  err: unknown,
  fallback: string,
): BulkRowResult {
  const serverError = (err as { serverError?: string }).serverError
  const status = (err as { status?: number }).status
  let message = serverError
  if ((!message || message === `HTTP ${status}`) && status === 409) {
    message = 'Skipped — has an active run'
  }
  return {
    id: wf.id,
    name: wf.name,
    outcome: 'failed',
    message: message ?? (err instanceof Error ? err.message : fallback),
  }
}

function summarise(results: Array<BulkRowResult>): BulkSummary {
  return {
    deleted: results.filter((r) => r.outcome === 'deleted').length,
    reset: results.filter((r) => r.outcome === 'reset').length,
    failed: results.filter((r) => r.outcome === 'failed').length,
    results,
  }
}
