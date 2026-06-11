'use client'

/**
 * EvalTable — shows offline eval run results for an experiment.
 * Joins scenario_results → eval_runs by eval_run_id to label offline vs live.
 */
import type { EvalRun, ScenarioResult } from '@/lib/self-improve-types'

interface EvalTableProps {
  evalRuns: Array<EvalRun>
  scenarioResults: Array<ScenarioResult>
}

export function EvalTable({ evalRuns, scenarioResults }: EvalTableProps) {
  // Build a map from eval_run_id → EvalRun for fast lookup
  const runMap = new Map<number, EvalRun>(evalRuns.map((r) => [r.id, r]))

  // Only show results from offline runs
  const offlineRunIds = new Set(
    evalRuns.filter((r) => r.kind === 'offline').map((r) => r.id),
  )
  const offlineResults = scenarioResults.filter((sr) => offlineRunIds.has(sr.eval_run_id))

  if (offlineResults.length === 0) {
    return (
      <div className="si-eval-empty">No offline eval results yet</div>
    )
  }

  const passCount = offlineResults.filter((r) => r.pass_fail === 1).length
  const total = offlineResults.length

  return (
    <div className="si-eval-root">
      <div className="si-eval-summary">
        <span className="si-eval-summary-pass">{passCount}</span>
        {' / '}
        <span className="si-eval-summary-total">{total}</span>
        {' pass'}
        {offlineResults[0] && (
          <span className="si-eval-summary-split">
            {' · '}
            {runMap.get(offlineResults[0].eval_run_id)?.kind ?? 'offline'} run
          </span>
        )}
      </div>
      <table className="si-eval-table">
        <thead>
          <tr>
            <th>Split</th>
            <th>Pass</th>
            <th>Rationale</th>
          </tr>
        </thead>
        <tbody>
          {offlineResults.map((r) => (
            <tr key={r.id} className={r.pass_fail === 1 ? 'si-eval-row--pass' : 'si-eval-row--fail'}>
              <td className="si-eval-cell-split">{r.split}</td>
              <td className="si-eval-cell-pass">
                {r.pass_fail === 1 ? '✓' : '✗'}
              </td>
              <td className="si-eval-cell-rationale">{r.judge_rationale}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
