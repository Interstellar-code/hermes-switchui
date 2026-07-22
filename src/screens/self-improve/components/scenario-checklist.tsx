'use client'

import type { ScenarioResult } from '@/lib/self-improve-types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ScenarioChecklistProps {
  results: Array<ScenarioResult>
  label?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseScenarioSnapshot(snapshot: string): {
  input: string
  name: string
} {
  try {
    const obj = JSON.parse(snapshot) as { input?: string; name?: string }
    return {
      input: obj.input ?? '',
      name: obj.name ?? '(unnamed)',
    }
  } catch {
    return { input: '', name: '(unnamed)' }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScenarioChecklist({
  results,
  label = 'Evaluation results',
}: ScenarioChecklistProps) {
  if (results.length === 0) {
    return <div className="si-checklist-empty">No scenario results yet.</div>
  }

  const passed = results.filter((r) => r.pass_fail === 1).length
  const total = results.length

  return (
    <div className="si-checklist">
      <div className="si-checklist-summary">
        <span>{label}</span>
        <strong>
          {passed}/{total} scenarios passed
        </strong>
      </div>
      <ul className="si-checklist-list">
        {results.map((r) => {
          const { name } = parseScenarioSnapshot(r.scenario_snapshot)
          const ok = r.pass_fail === 1
          return (
            <li
              key={r.id}
              className={`si-checklist-row${ok ? '' : ' si-checklist-row--fail'}`}
              title={r.judge_rationale}
            >
              <span className="si-checklist-icon">{ok ? '✓' : '✗'}</span>
              <span className="si-checklist-name">{name}</span>
              {r.split === 'holdout' && (
                <span className="si-checklist-holdout">holdout</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
