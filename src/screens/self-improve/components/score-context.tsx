'use client'

import { InfoTooltip } from './info-tooltip'
import type { ReactNode } from 'react'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ScoreContextProps {
  /** offline_score (0–1 fraction), null if not run */
  offline: number | null
  /** live aggregate_score from eval_runs (0–1 fraction), null if not run */
  live: number | null
  /** baseline score for this file (0–1 fraction), null if none */
  baselineScore: number | null
  /** sentence_delta_count — number of sentences changed */
  atomic: number | null
  /** Plugin eval-run evidence. A score is never derived by this UI. */
  offlineRunId: number | null
  offlineResultCount: number
  liveRunId: number | null
  liveResultCount: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number): string {
  return (v * 100).toFixed(1) + '%'
}

function deltaClass(delta: number): string {
  if (delta > 0) return 'si-score-delta--up'
  if (delta < 0) return 'si-score-delta--down'
  return 'si-score-delta--flat'
}

function deltaArrow(delta: number): string {
  if (delta > 0) return '▲'
  if (delta < 0) return '▼'
  return '='
}

interface ScoreBarProps {
  label: ReactNode
  score: number | null
  baselineScore: number | null
  emptyLabel: string
}

function ScoreBar({ label, score, baselineScore, emptyLabel }: ScoreBarProps) {
  if (score === null) {
    return (
      <div className="si-score-bar-row">
        <span className="si-score-bar-label">{label}</span>
        <span className="si-score-bar-empty">{emptyLabel}</span>
      </div>
    )
  }

  const fillPct = Math.min(100, Math.max(0, score * 100))
  const baselinePct =
    baselineScore !== null
      ? Math.min(100, Math.max(0, baselineScore * 100))
      : null
  const delta = baselineScore !== null ? score - baselineScore : null

  return (
    <div className="si-score-bar-row">
      <span className="si-score-bar-label">{label}</span>
      <div className="si-score-bar-track">
        <div className="si-score-bar-fill" style={{ width: `${fillPct}%` }} />
        {baselinePct !== null && (
          <div
            className="si-score-bar-baseline"
            style={{ left: `${baselinePct}%` }}
            title={
              baselineScore !== null
                ? `Baseline: ${pct(baselineScore)}`
                : undefined
            }
          />
        )}
      </div>
      <span className="si-score-bar-value">{pct(score)}</span>
      {delta !== null && (
        <span className={`si-score-delta ${deltaClass(delta)}`}>
          {deltaArrow(delta)} {pct(Math.abs(delta))}
        </span>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScoreContext({
  offline,
  live,
  baselineScore,
  atomic,
  offlineRunId,
  offlineResultCount,
  liveRunId,
  liveResultCount,
}: ScoreContextProps) {
  return (
    <div className="si-score-context">
      <div className="si-score-context-header">
        <InfoTooltip term="offline" label="Behavior-test pass rate" />
        <span className="si-score-context-subtitle">
          · higher is better · 0–1 = fraction of scenarios passed
        </span>
      </div>

      <ScoreBar
        label="Offline"
        score={offline}
        baselineScore={baselineScore}
        emptyLabel="not run"
      />
      <ScoreBar
        label={<InfoTooltip term="live" label="Live" />}
        score={live}
        baselineScore={baselineScore}
        emptyLabel="not run yet"
      />

      <p className="si-score-source">
        {offlineRunId === null
          ? 'Offline has not run yet.'
          : `Offline is the backend aggregate from run #${offlineRunId}; ${offlineResultCount === 0 ? 'no per-scenario rows were returned.' : `${offlineResultCount} scenario result${offlineResultCount === 1 ? '' : 's'} recorded.`}`}
        {liveRunId !== null &&
          ` Live run #${liveRunId}: ${liveResultCount} scenario result${liveResultCount === 1 ? '' : 's'} recorded.`}
      </p>

      {atomic !== null && (
        <div className="si-score-atomic">
          <InfoTooltip
            term="atomic edit"
            label={`atomic edit · ${atomic} sentence${atomic === 1 ? '' : 's'} changed`}
          />
        </div>
      )}
    </div>
  )
}
