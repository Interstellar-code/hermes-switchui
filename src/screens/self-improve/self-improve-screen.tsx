'use client'

import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BaselineChart } from './components/baseline-chart'
import { ExperimentCard } from './components/experiment-card'
import { ProfileScopeSelect } from './components/profile-scope-select'
import type { Baseline, MetricsSnapshot, PluginHealth, Scenario } from '@/lib/self-improve-types'
import { useAgentProfiles } from '@/hooks/use-agent-profiles'
import { toast } from '@/components/ui/toast'
import {
  createScenario,
  deleteScenario,
  fetchBaselines,
  fetchExperiments,
  fetchHealth,
  fetchLatestMetrics,
  fetchMetrics,
  fetchScenarios,
  pauseProfile,
  resumeProfile,
  triggerCollect,
  triggerPropose,
} from '@/lib/self-improve-api'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import './self-improve-screen.css'

// ── Query keys ────────────────────────────────────────────────────────────────

const QK_HEALTH = ['self-improve', 'health'] as const
const QK_LATEST = ['self-improve', 'metrics-latest'] as const
const QK_HISTORY = ['self-improve', 'metrics-history'] as const
const QK_BASELINES = ['self-improve', 'baselines'] as const
// P3 query keys — scenarios are per-profile so the key includes profile + holdout flag
const qkScenarios = (profile: string, includeHoldout: boolean) =>
  ['self-improve', 'scenarios', profile, includeHoldout] as const

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

// ── Experiments feed (unified proposals + lifecycle) ─────────────────────────

interface ExperimentsFeedProps {
  profile: string
  baselines: Array<Baseline>
  onMutated: () => void
}

function ExperimentsFeed({ profile, baselines, onMutated }: ExperimentsFeedProps) {
  const queryClient = useQueryClient()

  const experimentsQuery = useQuery({
    queryKey: ['self-improve', 'experiments', 'all', profile],
    queryFn: () => fetchExperiments({ profile: profile || undefined }),
    refetchInterval: REFETCH_INTERVAL,
  })

  const proposeMutation = useMutation({
    mutationFn: (p: string) => triggerPropose(p),
    onSuccess: (data) => {
      if ('skipped' in data) {
        toast(`Propose skipped: ${data.reason}`)
      } else {
        toast(`Proposal created (experiment #${'experiment_id' in data ? data.experiment_id : '?'})`)
        void queryClient.invalidateQueries({ queryKey: ['self-improve', 'experiments'] })
      }
      onMutated()
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Propose failed', { type: 'error' }),
  })

  const experiments = (experimentsQuery.data ?? []).slice().sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )

  return (
    <div className="si-experiments-section">
      <div className="si-section-header">
        <h2 className="si-section-title">Experiments</h2>
        <button
          type="button"
          className="si-collect-btn si-btn-primary"
          disabled={proposeMutation.isPending || !profile}
          onClick={() => proposeMutation.mutate(profile)}
        >
          {proposeMutation.isPending
            ? 'Proposing…'
            : profile
              ? `Propose · ${profile}`
              : 'Propose'}
        </button>
      </div>

      {experimentsQuery.isLoading ? (
        <div className="si-loading">Loading experiments…</div>
      ) : experimentsQuery.isError ? (
        <div className="si-error-msg">
          {experimentsQuery.error instanceof Error
            ? experimentsQuery.error.message
            : 'Failed to load experiments'}
        </div>
      ) : experiments.length === 0 ? (
        <div className="si-empty-state si-empty-state--proposals">
          <p>No experiments yet for this profile.</p>
          <p className="si-empty-sub">
            Click <strong>Propose</strong> to have the agent generate an improvement proposal.
          </p>
        </div>
      ) : (
        <div className="si-exp-list">
          {experiments.map((exp) => (
            <ExperimentCard
              key={exp.id}
              exp={exp}
              profile={profile}
              baselines={baselines}
              onMutated={onMutated}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── P3: Scenario section ──────────────────────────────────────────────────────

interface ScenarioSectionProps {
  profile: string
}

function ScenarioSection({ profile }: ScenarioSectionProps) {
  const queryClient = useQueryClient()
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

  // ── Global profile selector (FIX 1) ──────────────────────────────────────
  const { profiles: agentProfiles, activeProfile } = useAgentProfiles()
  const [profile, setProfile] = useState(
    activeProfile.length > 0
      ? activeProfile
      : agentProfiles.length > 0
        ? agentProfiles[0]
        : '',
  )

  // Dismissible intro card — persisted to localStorage
  const [introDismissed, setIntroDismissed] = useState(
    typeof window !== 'undefined' && window.localStorage.getItem('si-intro-dismissed') === 'true',
  )

  function dismissIntro() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('si-intro-dismissed', 'true')
    }
    setIntroDismissed(true)
  }

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

  // The metrics snapshot for the currently-selected profile
  const activeSnapshot = snapshots.find((s) => s.profile === profile) ?? null

  return (
    <div className="si-screen">
      {/* ── Dismissible intro card (FIX 5) ── */}
      {!introDismissed && (
        <div className="si-intro-card">
          <span className="si-intro-text">
            This page lets the agent propose one small edit to a profile's instructions, test it
            against behavior scenarios (graded by a different model), and keep it only if it scores
            better — with your approval. Each kept change is committed to git.
          </span>
          <button
            type="button"
            className="si-intro-dismiss"
            onClick={dismissIntro}
            aria-label="Dismiss intro"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Page header with global profile selector ── */}
      <div className="si-header">
        <div className="si-title-row">
          <h1 className="si-title">Self-Improve</h1>
          <div className="si-header-controls">
            <ProfileScopeSelect
              value={profile}
              onChange={setProfile}
              profiles={agentProfiles}
            />
            <button
              type="button"
              className="si-collect-btn"
              disabled={collectMutation.isPending}
              onClick={() => collectMutation.mutate()}
            >
              {collectMutation.isPending ? 'Collecting…' : 'Collect now'}
            </button>
          </div>
        </div>
        {healthQuery.data && <HealthStrip health={healthQuery.data} />}
      </div>

      {/* ── Metrics scorecard for selected profile (FIX 1) ── */}
      {isLoading ? (
        <SkeletonCards />
      ) : isError ? (
        <div className="si-error-state">
          <p className="si-error-msg">{errorMsg}</p>
          <button type="button" className="si-retry-btn" onClick={invalidateAll}>
            Retry
          </button>
        </div>
      ) : activeSnapshot !== null ? (
        <div className="si-cards-grid">
          <ProfileCard
            snapshot={activeSnapshot}
            history={history}
            baselines={baselines}
          />
        </div>
      ) : (
        <div className="si-empty-state">
          <p>
            {profile
              ? `No metrics collected yet for profile "${profile}".`
              : 'No metrics collected yet.'}
          </p>
          <p className="si-empty-sub">
            Click <strong>Collect now</strong> to run the first snapshot, or wait for the agent to
            emit metrics.
          </p>
        </div>
      )}

      {/* ── Unified experiments feed (FIX 2) ── */}
      <ExperimentsFeed profile={profile} baselines={baselines} onMutated={invalidateAll} />

      {/* ── Baseline curve — scoped to selected profile (FIX 1) ── */}
      <div className="si-baseline-chart-section">
        <div className="si-section-header">
          <h2 className="si-section-title">Baseline Curve</h2>
          <span className="si-section-caption">
            Score = fraction of behavior scenarios passed (0–100%). Higher is better.
          </span>
        </div>
        {baselines.length > 0 ? (
          <BaselineChart baselines={baselines} profile={profile} />
        ) : (
          <div className="si-empty-state">
            <p>No baseline data yet.</p>
            <p className="si-empty-sub">
              Baselines are created when an experiment is verified and promoted.
            </p>
          </div>
        )}
      </div>

      {/* ── Scenario management — scoped to selected profile (FIX 1) ── */}
      <ScenarioSection profile={profile} />
    </div>
  )
}
