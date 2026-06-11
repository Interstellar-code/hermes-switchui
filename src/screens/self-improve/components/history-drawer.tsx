'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { EvalTable } from './eval-table'
import type { Transition } from '@/lib/self-improve-types'
import { fetchExperimentHistory } from '@/lib/self-improve-api'

interface HistoryDrawerProps {
  experimentId: number | null
  onClose: () => void
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function TransitionRow({ t }: { t: Transition }) {
  return (
    <div className="si-ht-row">
      <div className="si-ht-states">
        <span className="si-state-badge si-state-badge--muted">{t.from_state ?? '—'}</span>
        <span className="si-ht-arrow">→</span>
        <span className={`si-state-badge si-state-badge--${t.to_state}`}>{t.to_state}</span>
      </div>
      <div className="si-ht-meta">
        <span className="si-ht-actor">{t.actor ?? 'system'}</span>
        {t.reason ? <span className="si-ht-reason">"{t.reason}"</span> : null}
        <span className="si-ht-time">{formatTs(t.created_at)}</span>
      </div>
    </div>
  )
}

export function HistoryDrawer({ experimentId, onClose }: HistoryDrawerProps) {
  // ESC to close
  useEffect(() => {
    if (!experimentId) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [experimentId, onClose])

  const historyQuery = useQuery({
    queryKey: ['self-improve', 'experiment-history', experimentId],
    queryFn: () => fetchExperimentHistory(experimentId!),
    enabled: experimentId != null,
  })

  const isOpen = experimentId != null

  return (
    <>
      {/* scrim */}
      <div
        className={`si-drawer-scrim${isOpen ? ' open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* panel */}
      <aside className={`si-drawer${isOpen ? ' open' : ''}`} aria-label="Experiment history">
        <div className="si-drawer-hdr">
          <h2 className="si-drawer-title">
            History{experimentId != null ? ` — Experiment #${experimentId}` : ''}
          </h2>
          <button type="button" className="si-drawer-close" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="si-drawer-body">
          {historyQuery.isLoading && (
            <div className="si-drawer-loading">Loading history…</div>
          )}
          {historyQuery.isError && (
            <div className="si-drawer-error">
              Failed to load history:{' '}
              {historyQuery.error instanceof Error
                ? historyQuery.error.message
                : 'Unknown error'}
            </div>
          )}
          {historyQuery.data && (
            <>
              {/* Transitions timeline */}
              <section className="si-drawer-section">
                <h3 className="si-drawer-section-title">State Transitions</h3>
                {historyQuery.data.transitions.length === 0 ? (
                  <p className="si-drawer-empty">No transitions recorded.</p>
                ) : (
                  <div className="si-ht-list">
                    {historyQuery.data.transitions.map((t) => (
                      <TransitionRow key={t.id} t={t} />
                    ))}
                  </div>
                )}
              </section>

              {/* Eval runs */}
              <section className="si-drawer-section">
                <h3 className="si-drawer-section-title">Eval Runs</h3>
                {historyQuery.data.eval_runs.length === 0 ? (
                  <p className="si-drawer-empty">No eval runs recorded.</p>
                ) : (
                  <div className="si-ht-eval-list">
                    {historyQuery.data.eval_runs.map((run) => (
                      <div key={run.id} className="si-ht-eval-row">
                        <span className={`si-state-badge si-state-badge--${run.kind === 'live' ? 'live' : 'approved'}`}>
                          {run.kind}
                        </span>
                        <span className="si-ht-eval-models">
                          {run.proposer_model ?? '—'} / {run.judge_model ?? '—'}
                        </span>
                        <span className="si-ht-eval-score">
                          {run.aggregate_score != null
                            ? run.aggregate_score.toFixed(3)
                            : '—'}
                        </span>
                        {run.cost != null ? (
                          <span className="si-ht-eval-cost">
                            ${run.cost < 0.01 ? run.cost.toFixed(4) : run.cost.toFixed(2)}
                          </span>
                        ) : null}
                        <span className="si-ht-time">{formatTs(run.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Per-scenario detail */}
              {historyQuery.data.scenario_results.length > 0 && (
                <section className="si-drawer-section">
                  <h3 className="si-drawer-section-title">Scenario Results</h3>
                  <EvalTable
                    evalRuns={historyQuery.data.eval_runs}
                    scenarioResults={historyQuery.data.scenario_results}
                  />
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
