'use client'

import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DiffView, SplitDiffView } from './diff-view'
import { HistoryDrawer } from './history-drawer'
import { LifecycleStepper } from './lifecycle-stepper'
import { ScenarioChecklist } from './scenario-checklist'
import { ScoreContext } from './score-context'
import type {
  Baseline,
  Experiment,
  ExperimentHistoryResponse,
} from '@/lib/self-improve-types'
import { Button } from '@/components/shadcn/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import {
  applyExperiment,
  approveExperiment,
  fetchExperimentHistory,
  rejectExperiment,
  revertExperiment,
} from '@/lib/self-improve-api'
import { toast } from '@/components/ui/toast'

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTOR = 'switchui-user'

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function stateBadgeClass(state: string): string {
  switch (state) {
    case 'proposed':
      return 'si-state-badge--muted'
    case 'approved':
      return 'si-state-badge--approved'
    case 'live':
      return 'si-state-badge--live'
    case 'verified':
      return 'si-state-badge--verified'
    case 'reverted':
      return 'si-state-badge--reverted'
    case 'rejected':
      return 'si-state-badge--rejected'
    default:
      return ''
  }
}

function stateTailWord(state: string): string {
  switch (state) {
    case 'verified':
    case 'live':
      return 'Kept.'
    case 'rejected':
      return 'Rejected.'
    case 'reverted':
      return 'Reverted.'
    case 'proposed':
      return 'Awaiting review.'
    case 'approved':
      return 'Approved, not yet applied.'
    default:
      return ''
  }
}

/** Apply-error toast copy: 422 = patch conflict, else generic. */
export function applyErrorMessage(e: unknown): string {
  if ((e as { status?: number }).status === 422) {
    return 'Patch failed — experiment not applied'
  }
  return e instanceof Error ? e.message : 'Apply failed'
}

/** Badge copy for live_takes_effect_at_next_session (1/null = next session, 0 = now). */
export function effectBadgeLabel(v: number | null): string {
  return v === 0 ? 'Live now' : 'Takes effect on next session'
}

export function latestRunForKind(
  history: ExperimentHistoryResponse | undefined,
  kind: 'offline' | 'live',
) {
  return (
    history?.eval_runs
      .filter((run) => run.kind === kind)
      .sort(
        (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id,
      )[0] ?? null
  )
}

export function resultsForRun(
  history: ExperimentHistoryResponse | undefined,
  evalRunId: number | null,
) {
  return evalRunId === null
    ? []
    : (history?.scenario_results ?? []).filter(
        (result) => result.eval_run_id === evalRunId,
      )
}

export function summarizeExperiment(
  exp: Experiment,
  liveScore: number | null,
): string {
  const parts: Array<string> = []

  // Rationale first sentence
  if (exp.rationale) {
    const firstSentence = exp.rationale.split(/[.!?]/)[0]?.trim()
    if (firstSentence) {
      parts.push(firstSentence + '.')
    }
  }

  // Score progression
  const hasOffline = exp.offline_score !== null
  const hasLive = liveScore !== null

  if (hasOffline || hasLive) {
    const offPct = hasOffline
      ? `${(exp.offline_score! * 100).toFixed(0)}%`
      : null
    const livePct = hasLive ? `${(liveScore * 100).toFixed(0)}%` : null

    if (offPct && livePct) {
      const delta = liveScore! - exp.offline_score!
      const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '='
      parts.push(`Behavior-test score ${offPct} → ${livePct} (${arrow}).`)
    } else if (offPct) {
      parts.push(`Offline score ${offPct}.`)
    }
  }

  // State tail
  const tail = stateTailWord(exp.state)
  if (tail) {
    parts.push(tail)
  }

  if (parts.length === 0) {
    return `Experiment #${exp.id} — ${exp.state}.`
  }

  return parts.join(' ')
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ExperimentCardProps {
  exp: Experiment
  /** The globally-selected profile (for invalidation context) */
  profile: string
  /** Baselines array — used to compute the per-file baseline score marker */
  baselines: Array<Baseline>
  /** Called after any mutation so the feed can refetch */
  onMutated: () => void
  onShowResults?: (kind: 'offline' | 'live') => void
  compact?: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ExperimentCard({
  exp,
  profile: _profile,
  baselines,
  onMutated,
  onShowResults,
  compact = false,
}: ExperimentCardProps) {
  const queryClient = useQueryClient()

  // Per-card history for stepper / live score / checklist
  const historyQuery = useQuery<ExperimentHistoryResponse>({
    queryKey: ['self-improve', 'experiment-history', exp.id],
    queryFn: () => fetchExperimentHistory(exp.id),
  })

  const history = historyQuery.data
  const offlineRun = latestRunForKind(history, 'offline')
  const liveRun = latestRunForKind(history, 'live')
  const liveScore = liveRun?.aggregate_score ?? null
  const offlineScore = offlineRun?.aggregate_score ?? exp.offline_score
  const [resultKind, setResultKind] = useState<'offline' | 'live'>('live')
  const selectedRun = resultKind === 'live' ? liveRun : offlineRun
  const scenarioResults = resultsForRun(history, selectedRun?.id ?? null)
  const targetFile = exp.target_relpath ?? exp.file
  const offlineResults = resultsForRun(history, offlineRun?.id ?? null)
  const liveResults = resultsForRun(history, liveRun?.id ?? null)

  // Find the most recent baseline for this experiment's file that predates (or equals)
  // this experiment's created_at, excluding this experiment's own baseline entry.
  // noUncheckedIndexedAccess is OFF — guard with .length before indexing.
  const baselineScore: number | null = (() => {
    const candidates = baselines.filter(
      (b) =>
        b.profile === exp.profile &&
        b.file === exp.file &&
        b.score !== null &&
        b.experiment_id !== exp.id &&
        b.created_at <= exp.created_at,
    )
    if (candidates.length > 0) {
      const sorted = candidates
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
      return sorted[0].score
    }
    // Fallback: latest baseline for this file excluding this experiment's own entry
    const fallbacks = baselines.filter(
      (b) =>
        b.profile === exp.profile &&
        b.file === exp.file &&
        b.score !== null &&
        b.experiment_id !== exp.id,
    )
    if (fallbacks.length > 0) {
      const sorted = fallbacks
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
      return sorted[0].score
    }
    return null
  })()

  // History drawer state
  const [historyOpen, setHistoryOpen] = useState(false)

  // Mutation state
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [applyOpen, setApplyOpen] = useState(false)
  const [revertOpen, setRevertOpen] = useState(false)
  const [revertReason, setRevertReason] = useState('')

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['self-improve', 'experiments'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['self-improve', 'metrics-latest'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['self-improve', 'baselines'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['self-improve', 'experiment-history', exp.id],
    })
    onMutated()
  }, [queryClient, exp.id, onMutated])

  const updateCachedState = useCallback(
    (state: Experiment['state']) => {
      queryClient.setQueriesData<Array<Experiment>>(
        { queryKey: ['self-improve', 'experiments'] },
        (experiments) =>
          experiments?.map((experiment) =>
            experiment.id === exp.id ? { ...experiment, state } : experiment,
          ),
      )
    },
    [queryClient, exp.id],
  )

  const approveMutation = useMutation({
    mutationFn: () => approveExperiment(exp.id, ACTOR),
    onSuccess: () => {
      updateCachedState('approved')
      invalidateAll()
      toast(`Experiment #${exp.id} approved`)
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Approve failed', {
        type: 'error',
      }),
  })

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => rejectExperiment(exp.id, ACTOR, reason),
    onSuccess: () => {
      updateCachedState('rejected')
      invalidateAll()
      toast(`Experiment #${exp.id} rejected`)
      setRejectOpen(false)
      setRejectReason('')
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Reject failed', {
        type: 'error',
      }),
  })

  const applyMutation = useMutation({
    mutationFn: () => applyExperiment(exp.id),
    onSuccess: () => {
      updateCachedState('live')
      invalidateAll()
      toast(`Experiment #${exp.id} applied — now live`)
    },
    onError: (e) => toast(applyErrorMessage(e), { type: 'error' }),
  })

  const revertMutation = useMutation({
    mutationFn: () => revertExperiment(exp.id, revertReason),
    onSuccess: () => {
      updateCachedState('reverted')
      invalidateAll()
      toast(`Experiment #${exp.id} reverted`)
      setRevertOpen(false)
      setRevertReason('')
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Revert failed', {
        type: 'error',
      }),
  })

  const isBusy =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    applyMutation.isPending ||
    revertMutation.isPending

  const summary = summarizeExperiment(exp, liveScore)

  return (
    <div className={`si-exp-card${compact ? ' si-exp-card--compact' : ''}`}>
      {/* ── Header row ── */}
      <div className="si-exp-header">
        <span className={`si-state-badge ${stateBadgeClass(exp.state)}`}>
          {exp.state}
        </span>
        <span className="si-effect-badge">
          {effectBadgeLabel(exp.live_takes_effect_at_next_session)}
        </span>
        <span className="si-exp-file">{targetFile}</span>
        <span className="si-exp-time">{relativeTime(exp.created_at)}</span>
        <span className="si-exp-id">#{exp.id}</span>
      </div>

      {/* ── Summary sentence ── */}
      <p className="si-exp-summary">{summary}</p>

      {!compact && (
        <>
          {/* ── HERO diff ── */}
          <div className="si-exp-diff-wrap">
            <SplitDiffView diff={exp.diff} className="si-exp-split-diff" />
            <DiffView
              diff={exp.diff}
              className="si-exp-diff si-exp-diff--narrow"
            />
          </div>

          {/* ── Score context strip ── */}
          <ScoreContext
            offline={offlineScore}
            live={liveScore}
            baselineScore={baselineScore}
            atomic={exp.sentence_delta_count}
            offlineRunId={offlineRun?.id ?? null}
            offlineResultCount={offlineResults.length}
            liveRunId={liveRun?.id ?? null}
            liveResultCount={liveResults.length}
          />

          {/* ── Lifecycle stepper ── */}
          <LifecycleStepper exp={exp} />

          {/* ── Scenario checklist ── */}
          {(offlineRun || liveRun) && (
            <div className="si-results">
              <div className="si-result-tabs" aria-label="Evaluation run">
                {(['offline', 'live'] as const).map((kind) => {
                  const run = kind === 'offline' ? offlineRun : liveRun
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={resultKind === kind}
                      className={resultKind === kind ? 'is-active' : ''}
                      disabled={!run}
                      onClick={() => setResultKind(kind)}
                    >
                      {kind === 'offline' ? 'Offline' : 'Live'}
                      {run?.aggregate_score !== null && run
                        ? ` · ${(run.aggregate_score * 100).toFixed(0)}%`
                        : ''}
                    </button>
                  )
                })}
              </div>
              <ScenarioChecklist
                results={scenarioResults}
                label={`${resultKind === 'offline' ? 'Offline' : 'Live'} evaluation`}
              />
              {onShowResults && selectedRun && (
                <button
                  type="button"
                  className="si-results-link"
                  onClick={() => onShowResults(resultKind)}
                >
                  View these results in Scenarios
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Action buttons ── */}
      <div className="si-exp-actions">
        {exp.state === 'proposed' && (
          <>
            <button
              type="button"
              className="si-action-btn si-action-btn--approve"
              disabled={isBusy}
              onClick={() => approveMutation.mutate()}
            >
              {approveMutation.isPending ? 'Approving…' : 'Approve'}
            </button>
            <button
              type="button"
              className="si-action-btn si-action-btn--reject"
              disabled={isBusy}
              onClick={() => setRejectOpen(true)}
            >
              Reject
            </button>
          </>
        )}

        {exp.state === 'approved' && (
          <button
            type="button"
            className="si-action-btn si-action-btn--approve"
            disabled={isBusy}
            onClick={() => setApplyOpen(true)}
          >
            {applyMutation.isPending ? 'Applying…' : 'Apply'}
          </button>
        )}

        {exp.state === 'live' && (
          <span className="si-action-note">
            Verification is performed by the daemon after its live-session
            target is reached.
          </span>
        )}

        {(exp.state === 'live' || exp.state === 'verified') && (
          <button
            type="button"
            className="si-action-btn si-action-btn--reject"
            disabled={isBusy}
            onClick={() => setRevertOpen(true)}
          >
            {revertMutation.isPending ? 'Reverting…' : 'Revert'}
          </button>
        )}

        <button
          type="button"
          className="si-action-btn"
          onClick={() => setHistoryOpen(true)}
        >
          History
        </button>
      </div>

      {/* ── Reject inline dialog ── */}
      {rejectOpen && (
        <div className="si-inline-dialog">
          <label className="si-inline-dialog-label">Reject reason</label>
          <textarea
            className="si-inline-textarea"
            rows={3}
            placeholder="Describe why you are rejecting…"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div className="si-inline-dialog-actions">
            <button
              type="button"
              className="si-action-btn"
              onClick={() => {
                setRejectOpen(false)
                setRejectReason('')
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="si-action-btn si-action-btn--reject"
              disabled={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate(rejectReason)}
            >
              {rejectMutation.isPending ? 'Rejecting…' : 'Confirm Reject'}
            </button>
          </div>
        </div>
      )}

      {/* ── Revert inline dialog ── */}
      {revertOpen && (
        <div className="si-inline-dialog">
          <label className="si-inline-dialog-label">Revert reason</label>
          <p className="si-inline-dialog-note">
            This restores the saved snapshot and marks the experiment reverted.
            A Git audit revert is created when the plugin has an audit SHA.
          </p>
          <textarea
            className="si-inline-textarea"
            rows={3}
            placeholder="Describe why you are reverting…"
            value={revertReason}
            onChange={(e) => setRevertReason(e.target.value)}
          />
          <div className="si-inline-dialog-actions">
            <button
              type="button"
              className="si-action-btn"
              onClick={() => {
                setRevertOpen(false)
                setRevertReason('')
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="si-action-btn si-action-btn--reject"
              disabled={revertMutation.isPending}
              onClick={() => revertMutation.mutate()}
            >
              {revertMutation.isPending ? 'Reverting…' : 'Confirm Revert'}
            </button>
          </div>
        </div>
      )}

      {/* ── Confirm dialogs ── */}
      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent className="si-apply-dialog">
          <DialogHeader>
            <DialogTitle>Apply experiment?</DialogTitle>
            <DialogDescription>
              This will write the diff to <code>{targetFile}</code> in profile{' '}
              <code>{exp.profile}</code>. A database snapshot rollback is
              guaranteed; the Git audit SHA is best-effort.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={applyMutation.isPending}
              onClick={() => setApplyOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={applyMutation.isPending}
              aria-busy={applyMutation.isPending}
              onClick={() => {
                setApplyOpen(false)
                applyMutation.mutate()
              }}
            >
              {applyMutation.isPending ? 'Applying…' : 'Apply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── History drawer ── */}
      <HistoryDrawer
        experimentId={historyOpen ? exp.id : null}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  )
}
