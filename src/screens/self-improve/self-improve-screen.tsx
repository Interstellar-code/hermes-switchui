'use client'

import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DiffView } from './components/diff-view'
import { EvalTable } from './components/eval-table'
import type { Baseline, Experiment, MetricsSnapshot, PluginHealth } from '@/lib/self-improve-types'
import { toast } from '@/components/ui/toast'
import {
  approveExperiment,
  createExperiment,
  fetchBaselines,
  fetchExperimentHistory,
  fetchExperiments,
  fetchHealth,
  fetchLatestMetrics,
  fetchMetrics,
  rejectExperiment,
  triggerCollect,
  triggerPropose,
} from '@/lib/self-improve-api'
import './self-improve-screen.css'

// ── Query keys ────────────────────────────────────────────────────────────────

const QK_HEALTH = ['self-improve', 'health'] as const
const QK_LATEST = ['self-improve', 'metrics-latest'] as const
const QK_HISTORY = ['self-improve', 'metrics-history'] as const
const QK_BASELINES = ['self-improve', 'baselines'] as const
const QK_PROPOSED = ['self-improve', 'experiments', 'proposed'] as const

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
}

function ProposalsSection({ profiles }: ProposalsSectionProps) {
  const queryClient = useQueryClient()
  const [proposeProfile, setProposeProfile] = useState(profiles[0] ?? '')

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
            {proposeMutation.isPending ? 'Proposing…' : `Propose${profiles.length === 1 ? ` (${profiles[0]})` : ''}`}
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
      <ProposalsSection profiles={snapshots.map((s) => s.profile)} />
    </div>
  )
}
