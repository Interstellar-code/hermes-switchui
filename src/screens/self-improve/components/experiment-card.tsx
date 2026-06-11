'use client'

import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DiffView } from './diff-view'
import { HistoryDrawer } from './history-drawer'
import { LifecycleStepper } from './lifecycle-stepper'
import { ScenarioChecklist } from './scenario-checklist'
import { ScoreContext } from './score-context'
import type { Baseline, Experiment, ExperimentHistoryResponse } from '@/lib/self-improve-types'
import {
  applyExperiment,
  approveExperiment,
  createExperiment,
  fetchExperimentHistory,
  rejectExperiment,
  revertExperiment,
  verifyExperiment,
} from '@/lib/self-improve-api'
import { toast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'

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

export function summarizeExperiment(exp: Experiment, liveScore: number | null): string {
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
    const offPct = hasOffline ? `${(exp.offline_score! * 100).toFixed(0)}%` : null
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
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ExperimentCard({ exp, profile: _profile, baselines, onMutated }: ExperimentCardProps) {
  const queryClient = useQueryClient()

  // Per-card history for stepper / live score / checklist
  const historyQuery = useQuery<ExperimentHistoryResponse>({
    queryKey: ['self-improve', 'experiment-history', exp.id],
    queryFn: () => fetchExperimentHistory(exp.id),
  })

  const history = historyQuery.data
  const liveRun = history?.eval_runs.find((r) => r.kind === 'live') ?? null
  const liveScore = liveRun?.aggregate_score ?? null
  const scenarioResults = history?.scenario_results ?? []

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
      const sorted = candidates.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
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
      const sorted = fallbacks.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
      return sorted[0].score
    }
    return null
  })()

  // History drawer state
  const [historyOpen, setHistoryOpen] = useState(false)

  // Mutation state
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editDiff, setEditDiff] = useState(exp.diff)
  const [editRationale, setEditRationale] = useState(exp.rationale)
  const [applyOpen, setApplyOpen] = useState(false)
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [revertOpen, setRevertOpen] = useState(false)
  const [revertReason, setRevertReason] = useState('')

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['self-improve', 'experiments'] })
    void queryClient.invalidateQueries({ queryKey: ['self-improve', 'metrics-latest'] })
    void queryClient.invalidateQueries({ queryKey: ['self-improve', 'baselines'] })
    void queryClient.invalidateQueries({
      queryKey: ['self-improve', 'experiment-history', exp.id],
    })
    onMutated()
  }, [queryClient, exp.id, onMutated])

  const approveMutation = useMutation({
    mutationFn: () => approveExperiment(exp.id, ACTOR),
    onSuccess: () => {
      invalidateAll()
      toast(`Experiment #${exp.id} approved`)
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Approve failed', { type: 'error' }),
  })

  const editApproveMutation = useMutation({
    mutationFn: async () => {
      const { experiment_id: newId } = await createExperiment({
        profile: exp.profile,
        file: exp.file,
        diff: editDiff,
        rationale: editRationale,
      })
      await approveExperiment(newId, ACTOR)
    },
    onSuccess: () => {
      invalidateAll()
      toast('Edited proposal created and approved')
      setEditOpen(false)
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Edit-approve failed', { type: 'error' }),
  })

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => rejectExperiment(exp.id, ACTOR, reason),
    onSuccess: () => {
      invalidateAll()
      toast(`Experiment #${exp.id} rejected`)
      setRejectOpen(false)
      setRejectReason('')
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Reject failed', { type: 'error' }),
  })

  const applyMutation = useMutation({
    mutationFn: () => applyExperiment(exp.id),
    onSuccess: () => {
      invalidateAll()
      toast(`Experiment #${exp.id} applied — now live`)
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Apply failed', { type: 'error' }),
  })

  const verifyMutation = useMutation({
    mutationFn: () => verifyExperiment(exp.id),
    onSuccess: () => {
      invalidateAll()
      toast(`Experiment #${exp.id} verified — promoted to baseline`)
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Verify failed', { type: 'error' }),
  })

  const revertMutation = useMutation({
    mutationFn: () => revertExperiment(exp.id, revertReason),
    onSuccess: () => {
      invalidateAll()
      toast(`Experiment #${exp.id} reverted`)
      setRevertOpen(false)
      setRevertReason('')
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Revert failed', { type: 'error' }),
  })

  const isBusy =
    approveMutation.isPending ||
    editApproveMutation.isPending ||
    rejectMutation.isPending ||
    applyMutation.isPending ||
    verifyMutation.isPending ||
    revertMutation.isPending

  const summary = summarizeExperiment(exp, liveScore)

  return (
    <div className="si-exp-card">
      {/* ── Header row ── */}
      <div className="si-exp-header">
        <span className={`si-state-badge ${stateBadgeClass(exp.state)}`}>{exp.state}</span>
        <span className="si-exp-file">{exp.file}</span>
        <span className="si-exp-time">{relativeTime(exp.created_at)}</span>
        <span className="si-exp-id">#{exp.id}</span>
      </div>

      {/* ── Summary sentence ── */}
      <p className="si-exp-summary">{summary}</p>

      {/* ── HERO diff ── */}
      <div className="si-exp-diff-wrap">
        <DiffView diff={exp.diff} className="si-exp-diff" />
      </div>

      {/* ── Score context strip ── */}
      <ScoreContext
        offline={exp.offline_score}
        live={liveScore}
        baselineScore={baselineScore}
        atomic={exp.sentence_delta_count}
      />

      {/* ── Lifecycle stepper ── */}
      <LifecycleStepper exp={exp} />

      {/* ── Scenario checklist ── */}
      {scenarioResults.length > 0 && (
        <ScenarioChecklist results={scenarioResults} />
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
              className="si-action-btn si-action-btn--edit"
              disabled={isBusy}
              onClick={() => {
                setEditDiff(exp.diff)
                setEditRationale(exp.rationale)
                setEditOpen(true)
              }}
            >
              Edit &amp; approve
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
          <button
            type="button"
            className="si-action-btn si-action-btn--approve"
            disabled={isBusy}
            onClick={() => setVerifyOpen(true)}
          >
            {verifyMutation.isPending ? 'Verifying…' : 'Verify'}
          </button>
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

      {/* ── Edit & approve inline dialog ── */}
      {editOpen && (
        <div className="si-inline-dialog">
          <p className="si-inline-dialog-note">
            This creates a new edited proposal and approves it immediately.
          </p>
          <label className="si-inline-dialog-label">Rationale</label>
          <textarea
            className="si-inline-textarea"
            rows={3}
            value={editRationale}
            onChange={(e) => setEditRationale(e.target.value)}
          />
          <label className="si-inline-dialog-label">Diff</label>
          <textarea
            className="si-inline-textarea si-inline-textarea--diff"
            rows={10}
            value={editDiff}
            onChange={(e) => setEditDiff(e.target.value)}
          />
          <div className="si-inline-dialog-actions">
            <button
              type="button"
              className="si-action-btn"
              onClick={() => setEditOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="si-action-btn si-action-btn--approve"
              disabled={editApproveMutation.isPending}
              onClick={() => editApproveMutation.mutate()}
            >
              {editApproveMutation.isPending ? 'Saving…' : 'Create & approve'}
            </button>
          </div>
        </div>
      )}

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
            This will git-revert the applied commit and mark the experiment reverted.
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
      <ConfirmDialog
        open={applyOpen}
        title="Apply experiment?"
        message={`This will write the diff to "${exp.file}" in profile "${exp.profile}" and create a git commit. Proceed?`}
        confirmLabel="Apply"
        onConfirm={() => {
          setApplyOpen(false)
          applyMutation.mutate()
        }}
        onCancel={() => setApplyOpen(false)}
      />
      <ConfirmDialog
        open={verifyOpen}
        title="Verify experiment?"
        message={`Mark experiment #${exp.id} as verified and promote to baseline?`}
        confirmLabel="Verify"
        onConfirm={() => {
          setVerifyOpen(false)
          verifyMutation.mutate()
        }}
        onCancel={() => setVerifyOpen(false)}
      />

      {/* ── History drawer ── */}
      <HistoryDrawer
        experimentId={historyOpen ? exp.id : null}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  )
}
