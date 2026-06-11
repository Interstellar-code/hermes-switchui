'use client'

import type { ScenarioResult } from '@/lib/self-improve-types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ScenarioChecklistProps {
  results: Array<ScenarioResult>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseName(snapshot: string): string {
  try {
    const obj = JSON.parse(snapshot) as { name?: string }
    return obj.name ?? '(unnamed)'
  } catch {
    return '(unnamed)'
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScenarioChecklist({ results }: ScenarioChecklistProps) {
  if (results.length === 0) {
    return (
      <div className="si-checklist-empty">No scenario results yet.</div>
    )
  }

  const passed = results.filter((r) => r.pass_fail === 1).length
  const total = results.length

  return (
    <div className="si-checklist">
      <div className="si-checklist-summary">
        {passed}/{total} scenarios passed
      </div>
      <ul className="si-checklist-list">
        {results.map((r) => {
          const name = parseName(r.scenario_snapshot)
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
