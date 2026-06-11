'use client'

import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DiffView } from './components/diff-view'
import { EvalTable } from './components/eval-table'
import { HistoryDrawer } from './components/history-drawer'
import { BaselineChart } from './components/baseline-chart'
import type { Baseline, Experiment, MetricsSnapshot, PluginHealth, Scenario } from '@/lib/self-improve-types'
import { useAgentProfiles } from '@/hooks/use-agent-profiles'
import { toast } from '@/components/ui/toast'
import {
  applyExperiment,
  approveExperiment,
  createExperiment,
  createScenario,
  deleteScenario,
  fetchBaselines,
  fetchExperimentHistory,
  fetchExperiments,
  fetchHealth,
  fetchLatestMetrics,
  fetchMetrics,
  fetchScenarios,
  pauseProfile,
  rejectExperiment,
  resumeProfile,
  revertExperiment,
  triggerCollect,
  triggerPropose,
  verifyExperiment,
} from '@/lib/self-improve-api'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import './self-improve-screen.css'

// ── Query keys ────────────────────────────────────────────────────────────────

const QK_HEALTH = ['self-improve', 'health'] as const
const QK_LATEST = ['self-improve', 'metrics-latest'] as const
const QK_HISTORY = ['self-improve', 'metrics-history'] as const
const QK_BASELINES = ['self-improve', 'baselines'] as const
const QK_PROPOSED = ['self-improve', 'experiments', 'proposed'] as const
const QK_LIFECYCLE = ['self-improve', 'experiments', 'lifecycle'] as const

// P3 query keys — scenarios are per-profile so the key includes profile + holdout flag
const qkScenarios = (profile: string, includeHoldout: boolean) =>
  ['self-improve', 'scenarios', profile, includeHoldout] as const

// ── Actor ─────────────────────────────────────────────────────────────────────

const ACTOR = 'switchui-user'

const REFETCH_INTERVAL = 30_000

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCost(cost: number): string {
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

function safeRate(numerator: number, denominator: number): string {
  if (denominator <= 0) return `${numerator} (raw)`
  return ((numerator / denominator) * 100).toFixed(1) + '%'
}

function safeTokensPerSession(tokens: number, sessions: number): string {
  if (sessions <= 0) return tokens.toLocaleString()
  return Math.round(tokens / sessions).toLocaleString()
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Sparkline (inline SVG, no deps) ──────────────────────────────────────────

function Sparkline({ values, width = 80, height = 24 }: { values: Array<number>; width?: number; height?: number }) {
  if (values.length < 2) {
    return <span className="si-spark-empty">—</span>
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const step = width / (values.length - 1)
  const pts = values
    .map((v, i) => {
      const x = i * step
      const y = height - ((v - min) / range) * (height - 4) - 2
      return `${x},${y}`
    })
    .join(' ')

  const last = values[values.length - 1]
  const prev = values[values.length - 2]
  const trend = last > prev ? 'up' : last < prev ? 'down' : 'flat'

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`si-sparkline si-sparkline--${trend}`}
      aria-hidden
    >
      <polyline points={pts} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Health strip ──────────────────────────────────────────────────────────────

function HealthStrip({ health }: { health: PluginHealth }) {
  return (
    <div className="si-health-strip">
      <span className={`si-health-dot ${health.ok ? 'si-health-dot--ok' : 'si-health-dot--err'}`} />
      <span className="si-health-label">{health.plugin}</span>
      <span className="si-health-version">v{health.version}</span>
      <span className="si-health-sep">·</span>
      <span className={`si-health-db ${health.db_exists ? '' : 'si-health-db--missing'}`}>
        {health.db_exists ? 'DB ready' : 'DB missing'}
      </span>
    </div>
  )
}

// ── Profile card ──────────────────────────────────────────────────────────────

interface ProfileCardProps {
  snapshot: MetricsSnapshot
  history: Array<MetricsSnapshot>
  baselines: Array<Baseline>
}

function ProfileCard({ snapshot, history, baselines }: ProfileCardProps) {
  const profileHistory = history.filter((m) => m.profile === snapshot.profile)
  const profileBaselines = baselines.filter((b) => b.profile === snapshot.profile)
  const noSessions = snapshot.sessions_count <= 0

  // Cost sparkline values (most recent last)
  const costValues = [...profileHistory].reverse().map((m) => m.cost)
  // Baseline score values (oldest first → newest last by created_at)
  const baselineScores = [...profileBaselines]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((b) => b.score ?? 0)

  // Delta vs previous cost snapshot
  const prevCost = costValues.length >= 2 ? costValues[costValues.length - 2] : null
  const costDelta = prevCost !== null ? snapshot.cost - prevCost : null

  return (
    <div className="si-card">
      <div className="si-card-header">
        <span className="si-profile-name">{snapshot.profile}</span>
        <span className="si-captured-at">{relativeTime(snapshot.captured_at)}</span>
      </div>

      {noSessions && (
        <div className="si-no-sessions-note">
          No sessions in window — metrics will populate once the agent logs activity with a profile tag.
        </div>
      )}

      <div className="si-metrics-grid">
        <div className="si-metric">
          <span className="si-metric-label">Sessions/window</span>
          <span className="si-metric-value">{snapshot.sessions_count.toLocaleString()}</span>
        </div>

        <div className="si-metric">
          <span className="si-metric-label">Error+Warn rate</span>
          <span className="si-metric-value">
            {safeRate(snapshot.error_count + snapshot.warn_count, snapshot.sessions_count)}
          </span>
          {noSessions && (
            <span className="si-metric-sub">
              {snapshot.error_count}E + {snapshot.warn_count}W
            </span>
          )}
        </div>

        <div className="si-metric">
          <span className="si-metric-label">Retries</span>
          <span className="si-metric-value">{snapshot.retries}</span>
        </div>

        <div className="si-metric">
          <span className="si-metric-label">Tokens/session</span>
          <span className="si-metric-value">
            {safeTokensPerSession(snapshot.tokens, snapshot.sessions_count)}
          </span>
        </div>

        <div className="si-metric si-metric--wide">
          <span className="si-metric-label">Cost trend</span>
          <div className="si-metric-row">
            <span className="si-metric-value">{formatCost(snapshot.cost)}</span>
            {costDelta !== null && (
              <span className={`si-delta ${costDelta > 0 ? 'si-delta--up' : costDelta < 0 ? 'si-delta--down' : ''}`}>
                {costDelta > 0 ? '+' : ''}{formatCost(costDelta)}
              </span>
            )}
            {costValues.length >= 2 && <Sparkline values={costValues} />}
          </div>
        </div>

        {baselineScores.length > 0 && (
          <div className="si-metric si-metric--wide">
            <span className="si-metric-label">Baseline scores</span>
            <div className="si-metric-row">
              <span className="si-metric-value">
                {baselineScores[baselineScores.length - 1].toFixed(2)}
              </span>
              {baselineScores.length >= 2 && <Sparkline values={baselineScores} />}
              <span className="si-metric-sub">{profileBaselines.length} baseline{profileBaselines.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCards() {
  return (
    <div className="si-cards-grid">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="si-card si-card--skeleton">
          <div className="si-skeleton-line" style={{ width: '40%' }} />
          <div className="si-skeleton-line" style={{ width: '70%', marginTop: 12 }} />
          <div className="si-skeleton-line" style={{ width: '55%' }} />
        </div>
      ))}
    </div>
  )
}

// ── Proposal card ─────────────────────────────────────────────────────────────

interface ProposalCardProps {
  exp: Experiment
  onApproved: () => void
  onRejected: () => void
}

function ProposalCard({ exp, onApproved, onRejected }: ProposalCardProps) {
  const queryClient = useQueryClient()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editDiff, setEditDiff] = useState(exp.diff)
  const [editRationale, setEditRationale] = useState(exp.rationale)

  const historyQuery = useQuery({
    queryKey: ['self-improve', 'experiment-history', exp.id],
    queryFn: () => fetchExperimentHistory(exp.id),
  })

  const invalidateProposed = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QK_PROPOSED })
  }, [queryClient])

  const approveMutation = useMutation({
    mutationFn: () => approveExperiment(exp.id, ACTOR),
    onSuccess: () => {
      invalidateProposed()
      toast(`Experiment #${exp.id} approved`)
      onApproved()
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Approve failed', { type: 'error' }),
  })

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => rejectExperiment(exp.id, ACTOR, reason),
    onSuccess: () => {
      invalidateProposed()
      toast(`Experiment #${exp.id} rejected`)
      setRejectOpen(false)
      setRejectReason('')
      onRejected()
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Reject failed', { type: 'error' }),
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
      invalidateProposed()
      toast(`Edited proposal created and approved`)
      setEditOpen(false)
      onApproved()
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Edit-approve failed', { type: 'error' }),
  })

  const createdAt = new Date(exp.created_at).toLocaleString()
  const offlineScore = exp.offline_score !== null ? exp.offline_score.toFixed(3) : '—'

  return (
    <div className="si-proposal-card">
      {/* Header */}
      <div className="si-proposal-header">
        <span className="si-proposal-profile">{exp.profile}</span>
        <span className="si-proposal-file">{exp.file}</span>
        <span className="si-proposal-score">score: {offlineScore}</span>
        <span className="si-proposal-date">{createdAt}</span>
        {exp.proposer_model && (
          <span className="si-proposal-model">proposer: {exp.proposer_model}</span>
        )}
        {exp.judge_model && (
          <span className="si-proposal-model">judge: {exp.judge_model}</span>
        )}
      </div>

      {/* Rationale */}
      {exp.rationale && (
        <p className="si-proposal-rationale">{exp.rationale}</p>
      )}

      {/* Diff */}
      <DiffView diff={exp.diff} className="si-proposal-diff" />

      {/* Eval table */}
      <div className="si-proposal-evals">
        {historyQuery.isPending ? (
          <div className="si-proposal-evals-loading">loading evals…</div>
        ) : historyQuery.data ? (
          <EvalTable
            evalRuns={historyQuery.data.eval_runs}
            scenarioResults={historyQuery.data.scenario_results}
          />
        ) : null}
      </div>

      {/* Actions */}
      <div className="si-proposal-actions">
        <button
          type="button"
          className="si-action-btn si-action-btn--approve"
          disabled={approveMutation.isPending || editApproveMutation.isPending}
          onClick={() => approveMutation.mutate()}
        >
          {approveMutation.isPending ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          className="si-action-btn si-action-btn--reject"
          disabled={rejectMutation.isPending || editApproveMutation.isPending}
          onClick={() => setRejectOpen(true)}
        >
          Reject
        </button>
        <button
          type="button"
          className="si-action-btn si-action-btn--edit"
          disabled={approveMutation.isPending || editApproveMutation.isPending}
          onClick={() => {
            setEditDiff(exp.diff)
            setEditRationale(exp.rationale)
            setEditOpen(true)
          }}
        >
          Edit &amp; approve
        </button>
      </div>

      {/* Reject inline dialog */}
      {rejectOpen && (
        <div className="si-inline-dialog">
          <p className="si-inline-dialog-label">Reason for rejection:</p>
          <textarea
            className="si-inline-textarea"
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Optional reason…"
          />
          <div className="si-inline-dialog-actions">
            <button
              type="button"
              className="si-action-btn"
              onClick={() => { setRejectOpen(false); setRejectReason('') }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="si-action-btn si-action-btn--reject"
              disabled={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate(rejectReason)}
            >
              {rejectMutation.isPending ? 'Rejecting…' : 'Confirm reject'}
            </button>
          </div>
        </div>
      )}

      {/* Edit-then-approve inline dialog */}
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
    </div>
  )
}

// ── Proposals section ─────────────────────────────────────────────────────────

interface ProposalsSectionProps {
  profiles: Array<string>
  defaultProfile?: string
}

function ProposalsSection({ profiles, defaultProfile }: ProposalsSectionProps) {
  const queryClient = useQueryClient()
  const [proposeProfile, setProposeProfile] = useState(defaultProfile ?? (profiles.length > 0 ? profiles[0] : ''))

  const proposedQuery = useQuery({
    queryKey: QK_PROPOSED,
    queryFn: () => fetchExperiments({ state: 'proposed' }),
    refetchInterval: 30_000,
  })

  const proposeMutation = useMutation({
    mutationFn: (profile: string) => triggerPropose(profile),
    onSuccess: (data) => {
      if ('skipped' in data) {
        toast(`Propose skipped: ${data.reason}`)
      } else {
        toast(`Proposal created (experiment #${'experiment_id' in data ? data.experiment_id : '?'})`)
        void queryClient.invalidateQueries({ queryKey: QK_PROPOSED })
      }
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Propose failed', { type: 'error' }),
  })

  const handleApprovedOrRejected = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QK_PROPOSED })
  }, [queryClient])

  return (
    <div className="si-proposals-section">
      <div className="si-proposals-header">
        <h2 className="si-proposals-title">Proposals</h2>
        <div className="si-propose-controls">
          {profiles.length > 1 && (
            <select
              className="si-propose-select"
              value={proposeProfile}
              onChange={(e) => setProposeProfile(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="si-collect-btn"
            disabled={proposeMutation.isPending}
            onClick={() => proposeMutation.mutate(proposeProfile || (profiles[0] ?? ''))}
          >
            {proposeMutation.isPending ? 'Proposing…' : `Propose${profiles.length === 1 ? ` · ${profiles[0]}` : ''}`}
          </button>
        </div>
      </div>

      {proposedQuery.isLoading ? (
        <div className="si-proposals-loading">
          <div className="si-skeleton-line" style={{ width: '60%' }} />
          <div className="si-skeleton-line" style={{ width: '40%', marginTop: 8 }} />
        </div>
      ) : proposedQuery.isError ? (
        <div className="si-error-state">
          <p className="si-error-msg">
            {proposedQuery.error instanceof Error ? proposedQuery.error.message : 'Failed to load proposals'}
          </p>
        </div>
      ) : !proposedQuery.data || proposedQuery.data.length === 0 ? (
        <div className="si-empty-state si-empty-state--proposals">
          <p>No pending proposals.</p>
          <p className="si-empty-sub">Click <strong>Propose</strong> to trigger the agent to generate a new improvement proposal.</p>
        </div>
      ) : (
        <div className="si-proposals-list">
          {proposedQuery.data.map((exp) => (
            <ProposalCard
              key={exp.id}
              exp={exp}
              onApproved={handleApprovedOrRejected}
              onRejected={handleApprovedOrRejected}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Lifecycle section (P2) ────────────────────────────────────────────────────

const LIFECYCLE_STATES = ['approved', 'live', 'verified', 'reverted', 'rejected'] as const

function stateBadgeClass(state: string): string {
  switch (state) {
    case 'approved': return 'si-state-badge--approved'
    case 'live': return 'si-state-badge--live'
    case 'verified': return 'si-state-badge--verified'
    case 'reverted': return 'si-state-badge--reverted'
    case 'rejected': return 'si-state-badge--rejected'
    default: return ''
  }
}

interface LifecycleCardProps {
  exp: Experiment
  onMutated: () => void
  onHistoryOpen: (id: number) => void
}

function LifecycleCard({ exp, onMutated, onHistoryOpen }: LifecycleCardProps) {
  const queryClient = useQueryClient()
  const [applyOpen, setApplyOpen] = useState(false)
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [revertOpen, setRevertOpen] = useState(false)
  const [revertReason, setRevertReason] = useState('')

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: QK_LIFECYCLE })
    void queryClient.invalidateQueries({ queryKey: QK_PROPOSED })
    void queryClient.invalidateQueries({ queryKey: QK_LATEST })
    void queryClient.invalidateQueries({ queryKey: QK_BASELINES })
  }

  const applyMutation = useMutation({
    mutationFn: () => applyExperiment(exp.id),
    onSuccess: () => {
      invalidateAll()
      toast(`Experiment #${exp.id} applied — now live`)
      onMutated()
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Apply failed', { type: 'error' }),
  })

  const verifyMutation = useMutation({
    mutationFn: () => verifyExperiment(exp.id),
    onSuccess: () => {
      invalidateAll()
      toast(`Experiment #${exp.id} verified — promoted to baseline`)
      onMutated()
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
      onMutated()
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Revert failed', { type: 'error' }),
  })

  const isBusy = applyMutation.isPending || verifyMutation.isPending || revertMutation.isPending

  // Live observation progress
  const progressPct =
    exp.live_sessions_target != null && exp.live_sessions_target > 0
      ? Math.min(100, (exp.live_sessions_observed / exp.live_sessions_target) * 100)
      : null

  return (
    <div className="si-lc-card">
      {/* Card header */}
      <div className="si-lc-header">
        <span className="si-proposal-profile">{exp.profile}</span>
        <span className="si-proposal-file">{exp.file}</span>
        <span className={`si-state-badge ${stateBadgeClass(exp.state)}`}>{exp.state}</span>
        <span className="si-lc-id">#{exp.id}</span>
      </div>

      {/* Scores + verdict */}
      <div className="si-lc-scores">
        <span className="si-lc-score-item">
          <span className="si-metric-label">offline</span>
          <span className="si-metric-value">{exp.offline_score != null ? exp.offline_score.toFixed(3) : '—'}</span>
        </span>
        {exp.live_score != null && (
          <span className="si-lc-score-item">
            <span className="si-metric-label">live</span>
            <span className="si-metric-value">{exp.live_score.toFixed(3)}</span>
          </span>
        )}
        {exp.verdict && (
          <span className="si-lc-verdict">{exp.verdict}</span>
        )}
      </div>

      {/* Live observation window */}
      {exp.state === 'live' && (
        <div className="si-lc-obs-window">
          <span className="si-lc-obs-label">
            {exp.live_sessions_target != null && exp.live_sessions_target > 0
              ? `${exp.live_sessions_observed} / ${exp.live_sessions_target} sessions observed`
              : `${exp.live_sessions_observed} sessions observed`}
          </span>
          {progressPct != null && (
            <div className="si-lc-progress-track">
              <div
                className="si-lc-progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Commit SHAs */}
      {(exp.base_commit_sha ?? exp.apply_commit_sha ?? exp.revert_commit_sha) && (
        <div className="si-lc-commits">
          {exp.base_commit_sha && (
            <span className="si-lc-sha" title="base commit">base: <code>{exp.base_commit_sha.slice(0, 7)}</code></span>
          )}
          {exp.apply_commit_sha && (
            <span className="si-lc-sha" title="apply commit">apply: <code>{exp.apply_commit_sha.slice(0, 7)}</code></span>
          )}
          {exp.revert_commit_sha && (
            <span className="si-lc-sha" title="revert commit">revert: <code>{exp.revert_commit_sha.slice(0, 7)}</code></span>
          )}
        </div>
      )}

      {/* Timestamps */}
      <div className="si-lc-timestamps">
        {exp.approved_at && <span><span className="si-metric-label">approved</span> {relativeTime(exp.approved_at)}</span>}
        {exp.applied_at && <span><span className="si-metric-label">applied</span> {relativeTime(exp.applied_at)}</span>}
        {exp.verified_at && <span><span className="si-metric-label">verified</span> {relativeTime(exp.verified_at)}</span>}
        {exp.reverted_at && <span><span className="si-metric-label">reverted</span> {relativeTime(exp.reverted_at)}</span>}
      </div>

      {/* Actions */}
      <div className="si-proposal-actions">
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
          onClick={() => onHistoryOpen(exp.id)}
        >
          History
        </button>
      </div>

      {/* Inline revert reason dialog */}
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
              onClick={() => { setRevertOpen(false); setRevertReason('') }}
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

      {/* Apply confirm dialog */}
      <ConfirmDialog
        open={applyOpen}
        title="Apply experiment?"
        message={`This will write the diff to "${exp.file}" in profile "${exp.profile}" and create a git commit. Proceed?`}
        confirmLabel="Apply"
        onConfirm={() => { setApplyOpen(false); applyMutation.mutate() }}
        onCancel={() => setApplyOpen(false)}
      />

      {/* Verify confirm dialog */}
      <ConfirmDialog
        open={verifyOpen}
        title="Verify experiment?"
        message={`Mark experiment #${exp.id} as verified and promote it to the baseline?`}
        confirmLabel="Verify"
        onConfirm={() => { setVerifyOpen(false); verifyMutation.mutate() }}
        onCancel={() => setVerifyOpen(false)}
      />
    </div>
  )
}

interface LifecycleSectionProps {
  profiles: Array<string>
}

function LifecycleSection({ profiles: _profiles }: LifecycleSectionProps) {
  const queryClient = useQueryClient()
  const [historyId, setHistoryId] = useState<number | null>(null)

  // Fetch all lifecycle-relevant states in one call; filter client-side.
  // Simpler and avoids N profile queries — the list is small.
  const lifecycleQuery = useQuery({
    queryKey: QK_LIFECYCLE,
    queryFn: () => fetchExperiments({}),
    refetchInterval: REFETCH_INTERVAL,
  })

  function handleMutated() {
    void queryClient.invalidateQueries({ queryKey: QK_LIFECYCLE })
  }

  const lifecycleExps = (lifecycleQuery.data ?? []).filter((e) =>
    (LIFECYCLE_STATES as ReadonlyArray<string>).includes(e.state) && e.state !== 'proposed',
  )

  return (
    <div className="si-lifecycle-section">
      <div className="si-proposals-header">
        <h2 className="si-proposals-title">Lifecycle</h2>
        {lifecycleQuery.isFetching && (
          <span className="si-proposals-loading" style={{ fontSize: 11, color: 'var(--theme-muted,#888)' }}>
            Refreshing…
          </span>
        )}
      </div>

      {lifecycleQuery.isLoading ? (
        <div className="si-proposals-loading">Loading experiments…</div>
      ) : lifecycleQuery.isError ? (
        <div className="si-error-msg">
          {lifecycleQuery.error instanceof Error
            ? lifecycleQuery.error.message
            : 'Failed to load lifecycle experiments'}
        </div>
      ) : lifecycleExps.length === 0 ? (
        <div className="si-empty-state si-empty-state--proposals">
          <p>No approved, live, or verified experiments.</p>
          <p className="si-empty-sub">Approve a proposal to start the lifecycle.</p>
        </div>
      ) : (
        <div className="si-lc-list">
          {lifecycleExps.map((exp) => (
            <LifecycleCard
              key={exp.id}
              exp={exp}
              onMutated={handleMutated}
              onHistoryOpen={setHistoryId}
            />
          ))}
        </div>
      )}

      <HistoryDrawer
        experimentId={historyId}
        onClose={() => setHistoryId(null)}
      />
    </div>
  )
}

// ── P3: Baseline chart section ────────────────────────────────────────────────

interface BaselineChartSectionProps {
  profiles: Array<string>
  baselines: Array<Baseline>
}

function BaselineChartSection({ profiles, baselines }: BaselineChartSectionProps) {
  const [selectedProfile, setSelectedProfile] = useState(profiles[0] ?? '')
  const profile = selectedProfile || (profiles[0] ?? '')

  return (
    <div className="si-baseline-chart-section">
      <div className="si-section-header">
        <h2 className="si-section-title">Baseline Curve</h2>
        {profiles.length > 1 && (
          <select
            className="si-propose-select"
            value={profile}
            onChange={(e) => setSelectedProfile(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
      </div>
      <BaselineChart baselines={baselines} profile={profile} />
    </div>
  )
}

// ── P3: Scenario section ──────────────────────────────────────────────────────

interface ScenarioSectionProps {
  profiles: Array<string>
  defaultProfile?: string
}

function ScenarioSection({ profiles, defaultProfile }: ScenarioSectionProps) {
  const queryClient = useQueryClient()
  const [selectedProfile, setSelectedProfile] = useState(defaultProfile ?? (profiles.length > 0 ? profiles[0] : ''))
  const [includeHoldout, setIncludeHoldout] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Scenario | null>(null)
  const [pauseTarget, setPauseTarget] = useState<string | null>(null)
  const [resumeTarget, setResumeTarget] = useState<string | null>(null)

  // Create form state
  const [newName, setNewName] = useState('')
  const [newInput, setNewInput] = useState('')
  const [newChecks, setNewChecks] = useState('')
  const [newHoldout, setNewHoldout] = useState(false)

  const profile = selectedProfile || (profiles[0] ?? '')
  const scenariosQK = qkScenarios(profile, includeHoldout)

  const scenariosQuery = useQuery({
    queryKey: scenariosQK,
    queryFn: () => fetchScenarios(profile, includeHoldout),
    enabled: !!profile,
  })

  function invalidateScenarios() {
    void queryClient.invalidateQueries({ queryKey: ['self-improve', 'scenarios', profile] })
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const checksArr = newChecks
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      return createScenario({
        profile,
        name: newName.trim(),
        input: newInput,
        checks: checksArr.length > 0 ? checksArr : undefined,
        holdout: newHoldout,
      })
    },
    onSuccess: (data) => {
      invalidateScenarios()
      toast(`Scenario #${data.scenario_id} created`)
      setCreateOpen(false)
      setNewName('')
      setNewInput('')
      setNewChecks('')
      setNewHoldout(false)
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Create failed', { type: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteScenario(id),
    onSuccess: () => {
      invalidateScenarios()
      toast('Scenario deleted')
      setDeleteTarget(null)
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Delete failed', { type: 'error' }),
  })

  const pauseMutation = useMutation({
    mutationFn: (p: string) => pauseProfile(p),
    onSuccess: (data) => {
      toast(`Profile "${data.profile}" paused`)
      setPauseTarget(null)
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Pause failed', { type: 'error' }),
  })

  const resumeMutation = useMutation({
    mutationFn: (p: string) => resumeProfile(p),
    onSuccess: (data) => {
      toast(`Profile "${data.profile}" resumed`)
      setResumeTarget(null)
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Resume failed', { type: 'error' }),
  })

  const scenarios = scenariosQuery.data ?? []

  return (
    <div className="si-scenario-section">
      <div className="si-section-header">
        <h2 className="si-section-title">Scenarios</h2>
        <div className="si-scenario-controls">
          {profiles.length > 1 && (
            <select
              className="si-propose-select"
              value={profile}
              onChange={(e) => setSelectedProfile(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
          <label className="si-holdout-toggle">
            <input
              type="checkbox"
              checked={includeHoldout}
              onChange={(e) => setIncludeHoldout(e.target.checked)}
            />
            Show held-out
          </label>
          <button
            type="button"
            className="si-collect-btn"
            onClick={() => setPauseTarget(profile)}
          >
            Pause
          </button>
          <button
            type="button"
            className="si-collect-btn si-btn-resume"
            onClick={() => setResumeTarget(profile)}
          >
            Resume
          </button>
          <button
            type="button"
            className="si-collect-btn si-btn-primary"
            onClick={() => setCreateOpen(true)}
          >
            + New scenario
          </button>
        </div>
      </div>

      <p className="si-pause-note">
        Note: paused state is not yet readable from the API — Pause/Resume are fire-and-confirm actions.
      </p>

      {scenariosQuery.isLoading && <div className="si-loading">Loading scenarios…</div>}
      {scenariosQuery.isError && (
        <div className="si-error">
          {scenariosQuery.error instanceof Error
            ? scenariosQuery.error.message
            : 'Failed to load scenarios'}
        </div>
      )}

      {!scenariosQuery.isLoading && !scenariosQuery.isError && scenarios.length === 0 && (
        <div className="si-empty">
          <p>No scenarios for <strong>{profile}</strong>.</p>
          {!includeHoldout && <p className="si-empty-sub">Try enabling "Show held-out" to see holdout scenarios.</p>}
        </div>
      )}

      {scenarios.length > 0 && (
        <table className="si-scenario-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Input</th>
              <th>Checks</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.id} className={s.holdout ? 'si-scenario-holdout' : ''}>
                <td className="si-scenario-id">#{s.id}</td>
                <td>
                  {s.name}
                  {s.holdout === 1 && <span className="si-badge si-badge-holdout">holdout</span>}
                </td>
                <td className="si-scenario-input" title={s.input}>{s.input ? s.input.slice(0, 60) + (s.input.length > 60 ? '…' : '') : '—'}</td>
                <td className="si-scenario-checks">
                  {s.checks && s.checks !== '[]' ? (
                    (() => {
                      try {
                        const arr = JSON.parse(s.checks) as Array<string>
                        return arr.length > 0 ? arr.slice(0, 2).join(', ') + (arr.length > 2 ? ` +${arr.length - 2}` : '') : '—'
                      } catch {
                        return s.checks.slice(0, 40)
                      }
                    })()
                  ) : '—'}
                </td>
                <td className="si-scenario-date">{s.created_at.slice(0, 10)}</td>
                <td>
                  <button
                    type="button"
                    className="si-action-btn si-action-btn--danger"
                    onClick={() => setDeleteTarget(s)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Create dialog */}
      {createOpen && (
        <div className="si-dialog-overlay" onClick={() => setCreateOpen(false)}>
          <div className="si-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="si-dialog-title">New Scenario</h3>
            <label className="si-dialog-label">
              Profile
              <input className="si-dialog-input" value={profile} readOnly />
            </label>
            <label className="si-dialog-label">
              Name <span className="si-required">*</span>
              <input
                className="si-dialog-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. basic-greeting"
                autoFocus
              />
            </label>
            <label className="si-dialog-label">
              Input
              <textarea
                className="si-dialog-textarea"
                value={newInput}
                onChange={(e) => setNewInput(e.target.value)}
                placeholder="User input for this scenario"
                rows={3}
              />
            </label>
            <label className="si-dialog-label">
              Checks (newline or comma separated)
              <textarea
                className="si-dialog-textarea"
                value={newChecks}
                onChange={(e) => setNewChecks(e.target.value)}
                placeholder={"contains greeting\nno profanity"}
                rows={3}
              />
            </label>
            <label className="si-dialog-label si-dialog-label--inline">
              <input
                type="checkbox"
                checked={newHoldout}
                onChange={(e) => setNewHoldout(e.target.checked)}
              />
              Hold-out (exclude from training eval)
            </label>
            <div className="si-dialog-actions">
              <button
                type="button"
                className="si-action-btn"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="si-collect-btn si-btn-primary"
                disabled={!newName.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete scenario"
        message={`Delete scenario "${deleteTarget?.name ?? ''}" (#${deleteTarget?.id ?? ''})? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id) }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Pause confirm */}
      <ConfirmDialog
        open={pauseTarget !== null}
        title="Pause profile"
        message={`Pause self-improvement for profile "${pauseTarget ?? ''}"? Note: paused state is not readable from the API — this is fire-and-confirm.`}
        confirmLabel="Pause"
        onConfirm={() => { if (pauseTarget) pauseMutation.mutate(pauseTarget) }}
        onCancel={() => setPauseTarget(null)}
      />

      {/* Resume confirm */}
      <ConfirmDialog
        open={resumeTarget !== null}
        title="Resume profile"
        message={`Resume self-improvement for profile "${resumeTarget ?? ''}"? Note: paused state is not readable from the API — this is fire-and-confirm.`}
        confirmLabel="Resume"
        onConfirm={() => { if (resumeTarget) resumeMutation.mutate(resumeTarget) }}
        onCancel={() => setResumeTarget(null)}
      />
    </div>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export function SelfImproveScreen() {
  const queryClient = useQueryClient()

  const healthQuery = useQuery({
    queryKey: QK_HEALTH,
    queryFn: fetchHealth,
    refetchInterval: REFETCH_INTERVAL,
  })

  const latestQuery = useQuery({
    queryKey: QK_LATEST,
    queryFn: fetchLatestMetrics,
    refetchInterval: REFETCH_INTERVAL,
  })

  const historyQuery = useQuery({
    queryKey: QK_HISTORY,
    queryFn: () => fetchMetrics({ limit: 100 }),
    refetchInterval: REFETCH_INTERVAL,
  })

  const baselinesQuery = useQuery({
    queryKey: QK_BASELINES,
    queryFn: () => fetchBaselines(),
    refetchInterval: REFETCH_INTERVAL,
  })

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['self-improve'] })
  }, [queryClient])

  const collectMutation = useMutation({
    mutationFn: triggerCollect,
    onSuccess: (data) => {
      invalidateAll()
      toast(`Collected ${data.collected} snapshot${data.collected !== 1 ? 's' : ''}`)
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Collect failed', { type: 'error' }),
  })

  const isLoading = latestQuery.isLoading || historyQuery.isLoading || baselinesQuery.isLoading
  const isError = latestQuery.isError || historyQuery.isError || baselinesQuery.isError
  const errorMsg =
    (latestQuery.error instanceof Error ? latestQuery.error.message : null) ??
    (historyQuery.error instanceof Error ? historyQuery.error.message : null) ??
    (baselinesQuery.error instanceof Error ? baselinesQuery.error.message : null) ??
    'Failed to load'

  const snapshots = latestQuery.data ?? []
  const history = historyQuery.data ?? []
  const baselines = baselinesQuery.data ?? []

  const { profiles: agentProfiles, activeProfile } = useAgentProfiles()

  return (
    <div className="si-screen">
      {/* Page header */}
      <div className="si-header">
        <div className="si-title-row">
          <h1 className="si-title">Self-Improve</h1>
          <button
            type="button"
            className="si-collect-btn"
            disabled={collectMutation.isPending}
            onClick={() => collectMutation.mutate()}
          >
            {collectMutation.isPending ? 'Collecting…' : 'Collect now'}
          </button>
        </div>
        {healthQuery.data && <HealthStrip health={healthQuery.data} />}
      </div>

      {/* Content */}
      {isLoading ? (
        <SkeletonCards />
      ) : isError ? (
        <div className="si-error-state">
          <p className="si-error-msg">{errorMsg}</p>
          <button type="button" className="si-retry-btn" onClick={invalidateAll}>
            Retry
          </button>
        </div>
      ) : snapshots.length === 0 ? (
        <div className="si-empty-state">
          <p>No metrics collected yet.</p>
          <p className="si-empty-sub">Click <strong>Collect now</strong> to run the first snapshot, or wait for the agent to emit metrics.</p>
        </div>
      ) : (
        <div className="si-cards-grid">
          {snapshots.map((snap) => (
            <ProfileCard
              key={snap.profile}
              snapshot={snap}
              history={history}
              baselines={baselines}
            />
          ))}
        </div>
      )}

      {/* Proposals section — always visible so users can trigger propose even before metrics */}
      <ProposalsSection profiles={agentProfiles} defaultProfile={activeProfile} />

      {/* Lifecycle section — approved/live/verified/reverted experiments */}
      <LifecycleSection profiles={agentProfiles} />

      {/* P3: Baseline curve chart — score over time per profile */}
      {snapshots.length > 0 && (
        <BaselineChartSection
          profiles={agentProfiles}
          baselines={baselines}
        />
      )}

      {/* P3: Scenario management — list/create/delete scenarios per profile */}
      {snapshots.length > 0 && (
        <ScenarioSection profiles={agentProfiles} defaultProfile={activeProfile} />
      )}
    </div>
  )
}
