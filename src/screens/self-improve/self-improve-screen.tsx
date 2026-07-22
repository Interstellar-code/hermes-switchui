'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BaselineChart } from './components/baseline-chart'
import {
  ExperimentCard,
  latestRunForKind,
  resultsForRun,
} from './components/experiment-card'
import { ProfileScopeSelect } from './components/profile-scope-select'
import { ProposeConfirmDialog } from './components/propose-confirm-dialog'
import { ScenarioDeleteDialog } from './components/scenario-delete-dialog'
import { ScenarioWizard } from './components/scenario-wizard'
import { StatusSummary } from './components/status-summary'
import { parseScenarioSnapshot } from './components/scenario-checklist'
import type {
  Baseline,
  Experiment,
  ExperimentHistoryResponse,
  MetricsSnapshot,
  PluginHealth,
  ProfileStatus,
  Scenario,
  ScenarioCheck,
} from '@/lib/self-improve-types'
import type { NextStep } from '@/lib/self-improve-next-step'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { computeNextStep } from '@/lib/self-improve-next-step'
import { useAgentProfiles } from '@/hooks/use-agent-profiles'
import { toast } from '@/components/ui/toast'
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from '@/components/ui/menu'
import {
  createScenario,
  deleteScenario,
  fetchBaselines,
  fetchExperimentHistory,
  fetchExperiments,
  fetchHealth,
  fetchLatestMetrics,
  fetchMetrics,
  fetchProfileStatus,
  fetchScenarios,
  pauseProfile,
  resumeProfile,
  triggerCollect,
  triggerPropose,
} from '@/lib/self-improve-api'
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
type EvaluationRunKind = 'offline' | 'live'
type ScenarioView = 'library' | 'results'

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatCost(cost: number): string {
  const sign = cost < 0 ? '-' : ''
  const absolute = Math.abs(cost)
  if (absolute === 0) return '$0.00'
  if (absolute < 0.01) return `${sign}$${absolute.toFixed(4)}`
  return `${sign}$${absolute.toFixed(2)}`
}

export function safeRate(numerator: number, denominator: number): string {
  if (denominator <= 0) return '—'
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

export function formatWindowRange(
  start: string | null,
  end: string | null,
): string | null {
  if (!start || !end) return null
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  return `${fmt(start)} → ${fmt(end)}`
}

export function selectAvailableProfile(
  current: string,
  active: string,
  profiles: Array<string>,
): string {
  if (profiles.includes(current)) return current
  if (profiles.includes(active)) return active
  return profiles[0] ?? ''
}

export function parseScenarioChecks(
  raw: string,
): Array<ScenarioCheck | string> {
  if (!raw || raw === '[]') return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((check): check is ScenarioCheck | string =>
          typeof check === 'string' && check.trim().length > 0
            ? true
            : isScenarioCheck(check),
        )
      : []
  } catch {
    return [raw]
  }
}

function isScenarioCheck(value: unknown): value is ScenarioCheck {
  if (!value || typeof value !== 'object') return false
  const check = value as Record<string, unknown>
  if (check.type === 'max_tokens') {
    return typeof check.value === 'number' && Number.isFinite(check.value)
  }
  if (check.type === 'judge') {
    return typeof check.rubric === 'string' && check.rubric.trim().length > 0
  }
  return (
    (check.type === 'must_contain' ||
      check.type === 'must_not_contain' ||
      check.type === 'tool_used') &&
    typeof check.value === 'string' &&
    check.value.trim().length > 0
  )
}

function scenarioCheckLabel(check: ScenarioCheck | string): string {
  if (typeof check === 'string') return check
  if (check.type === 'judge') return `Judge: ${check.rubric}`
  if (check.type === 'max_tokens') return `Max ${check.value} tokens`
  const labels = {
    must_contain: 'Must contain',
    must_not_contain: 'Must avoid',
    tool_used: 'Tool used',
  }
  return `${labels[check.type]}: ${check.value}`
}

// ── Sparkline (inline SVG, no deps) ──────────────────────────────────────────

function Sparkline({
  values,
  width = 80,
  height = 24,
}: {
  values: Array<number>
  width?: number
  height?: number
}) {
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
      <polyline
        points={pts}
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
  const profileBaselines = baselines.filter(
    (b) => b.profile === snapshot.profile,
  )
  const noSessions = snapshot.sessions_count <= 0

  // Cost sparkline values (most recent last)
  const costValues = [...profileHistory].reverse().map((m) => m.cost)
  // Baseline score values (oldest first → newest last by created_at)
  const baselineScores = [...profileBaselines]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((b) => b.score ?? 0)

  // Delta vs previous cost snapshot
  const prevCost =
    costValues.length >= 2 ? costValues[costValues.length - 2] : null
  const costDelta = prevCost !== null ? snapshot.cost - prevCost : null

  const windowRange = formatWindowRange(
    snapshot.window_started_at,
    snapshot.window_ended_at,
  )

  return (
    <div className="si-card">
      <div className="si-card-header">
        <span className="si-profile-name">{snapshot.profile}</span>
        <div className="si-card-header-meta">
          {windowRange && (
            <span className="si-window-range">Window: {windowRange}</span>
          )}
          <span className="si-captured-at">
            {relativeTime(snapshot.captured_at)}
          </span>
        </div>
      </div>

      {noSessions && (
        <div className="si-no-sessions-note">
          No sessions in window — metrics will populate once the agent logs
          activity with a profile tag.
        </div>
      )}

      <div className="si-metrics-grid">
        <div className="si-metric">
          <span className="si-metric-label">Sessions/window</span>
          <span className="si-metric-value">
            {snapshot.sessions_count.toLocaleString()}
          </span>
        </div>

        <div className="si-metric">
          <span className="si-metric-label">
            Log errors + warnings / session
          </span>
          <span
            className="si-metric-value"
            title={
              noSessions ? 'No sessions in window — rate undefined' : undefined
            }
          >
            {safeRate(
              snapshot.error_count + snapshot.warn_count,
              snapshot.sessions_count,
            )}
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
          <span className="si-metric-label">Cost (window)</span>
          <div className="si-metric-row">
            <span className="si-metric-value">{formatCost(snapshot.cost)}</span>
            {costDelta !== null && (
              <span
                className={`si-delta ${costDelta > 0 ? 'si-delta--up' : costDelta < 0 ? 'si-delta--down' : ''}`}
                title="vs previous snapshot"
              >
                {costDelta > 0 ? '+' : ''}
                {formatCost(costDelta)}
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
              {baselineScores.length >= 2 && (
                <Sparkline values={baselineScores} />
              )}
              <span className="si-metric-sub">
                {profileBaselines.length} baseline
                {profileBaselines.length !== 1 ? 's' : ''}
              </span>
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
          <div
            className="si-skeleton-line"
            style={{ width: '70%', marginTop: 12 }}
          />
          <div className="si-skeleton-line" style={{ width: '55%' }} />
        </div>
      ))}
    </div>
  )
}

// ── Run notebook: chronological experiment log ──────────────────────────────

export function passSummary(results: Array<{ pass_fail: 0 | 1 }>): string {
  if (results.length === 0) return 'Not run yet'
  const passed = results.filter((result) => result.pass_fail === 1).length
  return `${passed}/${results.length} passed`
}

function scoreLabel(score: number | null): string {
  return score === null ? 'Not measured yet' : `${(score * 100).toFixed(0)}%`
}

export function outcomeLabel(state: Experiment['state']): string {
  switch (state) {
    case 'proposed':
      return 'Awaiting review'
    case 'approved':
      return 'Ready to apply'
    case 'live':
      return 'Checking in real use'
    case 'verified':
      return 'Proven better'
    default:
      return 'Not kept'
  }
}

function ExperimentLogRow({
  exp,
  selected,
  onSelect,
}: {
  exp: Experiment
  selected: boolean
  onSelect: () => void
}) {
  const historyQuery = useQuery<ExperimentHistoryResponse>({
    queryKey: ['self-improve', 'experiment-history', exp.id],
    queryFn: () => fetchExperimentHistory(exp.id),
    refetchInterval: REFETCH_INTERVAL,
  })
  const history = historyQuery.data
  const offlineRun = latestRunForKind(history, 'offline')
  const liveRun = latestRunForKind(history, 'live')
  const offlineResults = resultsForRun(history, offlineRun?.id ?? null)
  const liveResults = resultsForRun(history, liveRun?.id ?? null)
  const isWaitingForLive = exp.state === 'live' && !liveRun
  const evidence = liveRun ? liveResults : offlineResults

  return (
    <button
      type="button"
      className={`si-experiment-log-row${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="si-experiment-log-main">
        <strong>#{exp.id}</strong>
        <span className="si-experiment-log-file">
          {exp.target_relpath ?? exp.file}
        </span>
        <span className="si-experiment-log-rationale">
          {exp.rationale || 'No rationale provided.'}
        </span>
      </span>
      <span className="si-experiment-log-evidence">
        <span title="Offline evaluation score">
          Offline {scoreLabel(offlineRun?.aggregate_score ?? exp.offline_score)}
        </span>
        <span title="Live evaluation score">
          {isWaitingForLive
            ? `Waiting for ${exp.live_sessions_target ?? 'live'} sessions`
            : `Live ${scoreLabel(liveRun?.aggregate_score ?? null)}`}
        </span>
        <span>
          {historyQuery.isLoading ? 'Loading evidence…' : passSummary(evidence)}
        </span>
        <span className="si-experiment-log-outcome">
          {outcomeLabel(exp.state)}
        </span>
      </span>
    </button>
  )
}

function ExperimentLog({
  experiments,
  selectedExperimentId,
  onSelect,
}: {
  experiments: Array<Experiment>
  selectedExperimentId: number | null
  onSelect: (id: number) => void
}) {
  if (experiments.length === 0) {
    return (
      <section className="si-experiment-log-section">
        <div className="si-section-header">
          <div>
            <span className="si-section-eyebrow">Learning loop</span>
            <h2 className="si-section-title">Experiment log</h2>
          </div>
        </div>
        <div className="si-empty-state">
          <p>No experiments yet.</p>
          <p className="si-empty-sub">
            Proposed changes and their evidence will appear here.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="si-experiment-log-section">
      <div className="si-section-header">
        <div>
          <span className="si-section-eyebrow">Learning loop</span>
          <h2 className="si-section-title">Experiment log</h2>
        </div>
        <p className="si-section-caption">
          Every change is compared against the same behavior metric.
        </p>
      </div>
      <div className="si-experiment-log-list">
        {experiments.map((experiment) => (
          <ExperimentLogRow
            key={experiment.id}
            exp={experiment}
            selected={selectedExperimentId === experiment.id}
            onSelect={() => onSelect(experiment.id)}
          />
        ))}
      </div>
    </section>
  )
}

function RunKpis({
  status,
  experiments,
}: {
  status: ProfileStatus | undefined
  experiments: Array<Experiment>
}) {
  const live = experiments.find((experiment) => experiment.state === 'live')
  const bestOffline = experiments.reduce<Experiment | null>(
    (best, experiment) =>
      experiment.offline_score === null ||
      (best !== null && experiment.offline_score <= (best.offline_score ?? 0))
        ? best
        : experiment,
    null,
  )
  const baseline = status?.latest_baseline_score ?? null

  return (
    <section className="si-run-kpis" aria-label="Run summary">
      <div className="si-run-kpi">
        <span>Metric</span>
        <strong>Scenario pass rate ↑</strong>
        <small>Fixed behavior tests</small>
      </div>
      <div className="si-run-kpi">
        <span>Verified baseline</span>
        <strong>{scoreLabel(baseline)}</strong>
        <small>
          {baseline === null ? 'No proven reference yet' : 'Higher is better'}
        </small>
      </div>
      <div className="si-run-kpi">
        <span>Best candidate</span>
        <strong>{scoreLabel(bestOffline?.offline_score ?? null)}</strong>
        <small>
          {bestOffline
            ? `Experiment #${bestOffline.id} · offline`
            : 'No candidate yet'}
        </small>
      </div>
      <div className="si-run-kpi">
        <span>Current run</span>
        <strong>
          {live
            ? `${live.live_sessions_observed}/${live.live_sessions_target ?? '—'} sessions`
            : 'No live candidate'}
        </strong>
        <small>
          {live ? 'Checking in real use' : 'Ready for the next experiment'}
        </small>
      </div>
    </section>
  )
}

// ── Selected experiment review ───────────────────────────────────────────────

interface ExperimentReviewProps {
  profile: string
  baselines: Array<Baseline>
  status: ProfileStatus | undefined
  nextStep: NextStep
  onMutated: () => void
  selectedExperimentId: number | null
  onSelectExperiment: (id: number) => void
  onShowResults: (kind: EvaluationRunKind) => void
}

function ExperimentListItem({
  exp,
  selected,
  onSelect,
}: {
  exp: Experiment
  selected: boolean
  onSelect: () => void
}) {
  const score = exp.live_score ?? exp.offline_score
  const path = exp.target_relpath ?? exp.file
  return (
    <button
      type="button"
      className={`si-experiment-list-item${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="si-experiment-list-topline">
        <span
          className={`si-experiment-list-state si-experiment-list-state--${exp.state}`}
        >
          {exp.state}
        </span>
        <span>#{exp.id}</span>
      </span>
      <strong>{path}</strong>
      <span className="si-experiment-list-rationale">
        {exp.rationale || 'No rationale provided.'}
      </span>
      <span className="si-experiment-list-foot">
        {score === null ? 'Not scored' : `${(score * 100).toFixed(0)}% score`}
        <span>{relativeTime(exp.created_at)}</span>
      </span>
    </button>
  )
}

function ExperimentReview({
  profile,
  baselines,
  status,
  nextStep,
  onMutated,
  selectedExperimentId,
  onSelectExperiment,
  onShowResults,
}: ExperimentReviewProps) {
  const queryClient = useQueryClient()
  // Propose spends API tokens — always confirm first.
  const [confirmOpen, setConfirmOpen] = useState(false)

  const experimentsQuery = useQuery({
    queryKey: ['self-improve', 'experiments', 'all', profile],
    queryFn: () => fetchExperiments({ profile }),
    enabled: !!profile,
    refetchInterval: REFETCH_INTERVAL,
  })

  const proposeMutation = useMutation({
    mutationFn: (p: string) => triggerPropose(p),
    onSuccess: (data) => {
      if ('skipped' in data) {
        toast(`Propose skipped: ${data.reason}`)
      } else {
        toast(
          `Proposal created (experiment #${'experiment_id' in data ? data.experiment_id : '?'})`,
        )
        void queryClient.invalidateQueries({
          queryKey: ['self-improve', 'experiments'],
        })
      }
      onMutated()
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Propose failed', {
        type: 'error',
      }),
    onSettled: () => setConfirmOpen(false),
  })

  const experiments = (experimentsQuery.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  const selectedExperiment =
    experiments.find((experiment) => experiment.id === selectedExperimentId) ??
    experiments[0]

  useEffect(() => {
    if (
      selectedExperimentId !== null &&
      experiments.some((experiment) => experiment.id === selectedExperimentId)
    ) {
      return
    }
    if (experiments[0]) onSelectExperiment(experiments[0].id)
  }, [experiments, selectedExperimentId, onSelectExperiment])

  return (
    <section className="si-experiment-review">
      <div className="si-section-header">
        <div>
          <span className="si-section-eyebrow">Selected experiment</span>
          <h2 className="si-section-title">Review the change</h2>
        </div>
        <button
          type="button"
          className="si-collect-btn si-btn-primary"
          disabled={proposeMutation.isPending || !profile}
          onClick={() => setConfirmOpen(true)}
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
          <button
            type="button"
            className="si-retry-btn"
            onClick={() => void experimentsQuery.refetch()}
          >
            Retry
          </button>
        </div>
      ) : experiments.length === 0 ? (
        <div className="si-empty-state si-empty-state--proposals">
          <p>No experiments yet for this profile.</p>
          <p className="si-empty-sub">
            An experiment is created when the agent proposes a change. Next:{' '}
            <strong>{nextStep.label}</strong> — {nextStep.hint}
          </p>
        </div>
      ) : (
        <div className="si-experiments-workbench">
          <div className="si-experiment-list" aria-label="Experiments">
            {experiments.map((exp) => (
              <ExperimentListItem
                key={exp.id}
                exp={exp}
                selected={selectedExperiment.id === exp.id}
                onSelect={() => onSelectExperiment(exp.id)}
              />
            ))}
          </div>
          <div className="si-experiment-detail">
            <ExperimentCard
              exp={selectedExperiment}
              profile={profile}
              baselines={baselines}
              onMutated={onMutated}
              onShowResults={onShowResults}
            />
          </div>
        </div>
      )}

      <ProposeConfirmDialog
        open={confirmOpen}
        profile={profile}
        targetRelpath={status?.target_relpath}
        proposerModel={status?.proposer_model}
        judgeModel={status?.judge_model}
        pending={proposeMutation.isPending}
        onConfirm={() => proposeMutation.mutate(profile)}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  )
}

// ── P3: Scenario section ──────────────────────────────────────────────────────

function ScenarioResults({
  experiment,
  resultKind,
  onResultKindChange,
  onShowExperiment,
}: {
  experiment: Experiment
  resultKind: EvaluationRunKind
  onResultKindChange: (kind: EvaluationRunKind) => void
  onShowExperiment: () => void
}) {
  const historyQuery = useQuery<ExperimentHistoryResponse>({
    queryKey: ['self-improve', 'experiment-history', experiment.id],
    queryFn: () => fetchExperimentHistory(experiment.id),
    refetchInterval: REFETCH_INTERVAL,
  })
  const history = historyQuery.data
  const offlineRun = latestRunForKind(history, 'offline')
  const liveRun = latestRunForKind(history, 'live')
  const run = resultKind === 'live' ? liveRun : offlineRun
  const results = resultsForRun(history, run?.id ?? null)

  return (
    <div className="si-scenario-results">
      <div className="si-results-context">
        <div>
          <span className="si-section-eyebrow">
            Experiment #{experiment.id}
          </span>
          <h3>{experiment.target_relpath ?? experiment.file}</h3>
        </div>
        <button
          type="button"
          className="si-action-btn"
          onClick={onShowExperiment}
        >
          View experiment
        </button>
      </div>
      <div className="si-result-tabs" aria-label="Evaluation run">
        {(['offline', 'live'] as const).map((kind) => {
          const candidate = kind === 'offline' ? offlineRun : liveRun
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={resultKind === kind}
              className={resultKind === kind ? 'is-active' : ''}
              disabled={!candidate}
              onClick={() => onResultKindChange(kind)}
            >
              {kind === 'offline' ? 'Offline' : 'Live'}
              {candidate?.aggregate_score !== null && candidate
                ? ` · ${scoreLabel(candidate.aggregate_score)}`
                : ''}
            </button>
          )
        })}
      </div>

      {historyQuery.isLoading ? (
        <div className="si-loading">Loading evaluation results…</div>
      ) : resultKind === 'live' && !liveRun ? (
        <div className="si-empty-state si-results-empty">
          <p>
            Waiting for {experiment.live_sessions_target ?? 'the required'} live
            sessions; no live results yet.
          </p>
          {offlineRun && (
            <button
              type="button"
              className="si-action-btn"
              onClick={() => onResultKindChange('offline')}
            >
              View offline results
            </button>
          )}
        </div>
      ) : results.length === 0 ? (
        <div className="si-empty-state si-results-empty">
          <p>No scenario results were stored for this run.</p>
        </div>
      ) : (
        <>
          <p className="si-results-summary">
            {resultKind === 'offline' ? 'Offline' : 'Live'} run ·{' '}
            {scoreLabel(run?.aggregate_score ?? null)} · {passSummary(results)}
          </p>
          <div className="si-result-list">
            {results.map((result) => {
              const snapshot = parseScenarioSnapshot(result.scenario_snapshot)
              const passed = result.pass_fail === 1
              return (
                <details
                  key={result.id}
                  className={`si-result-row${passed ? '' : ' si-result-row--fail'}`}
                >
                  <summary>
                    <span className="si-result-status">
                      {passed ? 'Passed' : 'Failed'}
                    </span>
                    <strong>{snapshot.name}</strong>
                    <span className="si-badge">
                      {result.split === 'holdout' ? 'held-out' : 'training'}
                    </span>
                  </summary>
                  <div className="si-result-detail">
                    {snapshot.input && (
                      <>
                        <span className="si-scenario-detail-label">Input</span>
                        <pre className="si-scenario-detail-input">
                          {snapshot.input}
                        </pre>
                      </>
                    )}
                    <span className="si-scenario-detail-label">
                      Judge rationale
                    </span>
                    <p>
                      {result.judge_rationale || 'No rationale was recorded.'}
                    </p>
                  </div>
                </details>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

interface ScenarioSectionProps {
  profile: string
  nextStep: NextStep
  experiments: Array<Experiment>
  selectedExperimentId: number | null
  onSelectExperiment: (id: number) => void
  view: ScenarioView
  onViewChange: (view: ScenarioView) => void
  resultKind: EvaluationRunKind
  onResultKindChange: (kind: EvaluationRunKind) => void
  onShowExperiment: () => void
}

function ScenarioSection({
  profile,
  nextStep,
  experiments,
  selectedExperimentId,
  onSelectExperiment,
  view,
  onViewChange,
  resultKind,
  onResultKindChange,
  onShowExperiment,
}: ScenarioSectionProps) {
  const queryClient = useQueryClient()
  const [splitFilter, setSplitFilter] = useState<'all' | 'train' | 'holdout'>(
    'all',
  )
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Scenario | null>(null)
  // Which scenario row is expanded — disclosure only, no route change
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const selectedExperiment =
    experiments.find((experiment) => experiment.id === selectedExperimentId) ??
    null

  const scenariosQK = qkScenarios(profile, true)

  const scenariosQuery = useQuery({
    queryKey: scenariosQK,
    queryFn: () => fetchScenarios(profile, true),
    enabled: !!profile && view === 'library',
    refetchInterval: REFETCH_INTERVAL,
  })

  function invalidateScenarios() {
    void queryClient.invalidateQueries({
      queryKey: ['self-improve', 'scenarios', profile],
    })
  }

  const createMutation = useMutation({
    mutationFn: createScenario,
    onSuccess: (data) => {
      invalidateScenarios()
      toast(`Scenario #${data.scenario_id} created`)
      setCreateOpen(false)
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Create failed', {
        type: 'error',
      }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteScenario(id),
    onSuccess: () => {
      invalidateScenarios()
      toast('Scenario deleted')
      setDeleteTarget(null)
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Delete failed', {
        type: 'error',
      }),
  })

  const scenarios = (scenariosQuery.data ?? []).filter((scenario) => {
    if (splitFilter === 'holdout') return scenario.holdout === 1
    if (splitFilter === 'train') return scenario.holdout === 0
    return true
  })

  const modeSwitch = (
    <div className="si-split-filter" aria-label="Scenario view">
      <button
        type="button"
        className={view === 'library' ? 'is-active' : ''}
        aria-pressed={view === 'library'}
        onClick={() => onViewChange('library')}
      >
        Library
      </button>
      <button
        type="button"
        className={view === 'results' ? 'is-active' : ''}
        aria-pressed={view === 'results'}
        disabled={!selectedExperiment}
        onClick={() => onViewChange('results')}
      >
        {selectedExperiment ? `Results · #${selectedExperiment.id}` : 'Results'}
      </button>
    </div>
  )

  return (
    <div className="si-scenario-section">
      <div className="si-section-header">
        <div>
          <span className="si-section-eyebrow">Evidence</span>
          <h2 className="si-section-title">Evaluation</h2>
        </div>
        <div className="si-scenario-controls">
          {modeSwitch}
          {experiments.length > 0 && (
            <select
              aria-label="Experiment results context"
              className="si-experiment-scope-select"
              value={selectedExperimentId ?? ''}
              onChange={(event) => {
                const id = Number(event.target.value)
                if (Number.isInteger(id) && id > 0) onSelectExperiment(id)
              }}
            >
              <option value="">Choose experiment</option>
              {experiments.map((experiment) => (
                <option key={experiment.id} value={experiment.id}>
                  #{experiment.id} ·{' '}
                  {experiment.target_relpath ?? experiment.file}
                </option>
              ))}
            </select>
          )}
          {view === 'library' && (
            <>
              <div
                className="si-split-filter"
                aria-label="Filter scenario split"
              >
                {(['all', 'train', 'holdout'] as const).map((split) => (
                  <button
                    key={split}
                    type="button"
                    className={splitFilter === split ? 'is-active' : ''}
                    aria-pressed={splitFilter === split}
                    onClick={() => setSplitFilter(split)}
                  >
                    {split === 'all'
                      ? 'All'
                      : split === 'train'
                        ? 'Training'
                        : 'Held-out'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="si-collect-btn si-btn-primary"
                disabled={!profile}
                onClick={() => {
                  createMutation.reset()
                  setCreateOpen(true)
                }}
              >
                + New scenario
              </button>
            </>
          )}
        </div>
      </div>

      {view === 'results' ? (
        selectedExperiment ? (
          <ScenarioResults
            experiment={selectedExperiment}
            resultKind={resultKind}
            onResultKindChange={onResultKindChange}
            onShowExperiment={onShowExperiment}
          />
        ) : (
          <div className="si-empty-state">
            <p>Select an experiment to see its scenario results.</p>
          </div>
        )
      ) : (
        <details className="si-scenario-manage" open={false}>
          <summary>Manage scenarios</summary>
          <div className="si-scenario-manage-body">
            {scenariosQuery.isLoading && (
              <div className="si-loading">Loading scenarios…</div>
            )}
            {scenariosQuery.isError && (
              <div className="si-error">
                {scenariosQuery.error instanceof Error
                  ? scenariosQuery.error.message
                  : 'Failed to load scenarios'}
                <button
                  type="button"
                  className="si-retry-btn"
                  onClick={() => void scenariosQuery.refetch()}
                >
                  Retry
                </button>
              </div>
            )}

            {!scenariosQuery.isLoading &&
              !scenariosQuery.isError &&
              scenarios.length === 0 &&
              ((scenariosQuery.data ?? []).length === 0 ? (
                <div className="si-empty">
                  <p>
                    No scenarios for <strong>{profile}</strong>.
                  </p>
                  <p className="si-empty-sub">
                    Scenarios define the behaviors experiments are graded
                    against. Next: <strong>{nextStep.label}</strong> —{' '}
                    {nextStep.hint}
                  </p>
                </div>
              ) : (
                <div className="si-empty">
                  <p>
                    No {splitFilter === 'train' ? 'training' : 'held-out'}{' '}
                    scenarios for <strong>{profile}</strong>.
                  </p>
                  <p className="si-empty-sub">Choose another split.</p>
                </div>
              ))}

            {scenarios.length > 0 && (
              <div className="si-table-scroll">
                <table className="si-scenario-table">
                  <thead>
                    <tr>
                      <th className="si-scenario-expand-cell"></th>
                      <th>ID</th>
                      <th>Name</th>
                      <th>Input</th>
                      <th>Checks</th>
                      <th>Created</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarios.map((s) => {
                      const checks = parseScenarioChecks(s.checks)
                      const expanded = expandedId === s.id
                      return (
                        <Fragment key={s.id}>
                          <tr
                            className={s.holdout ? 'si-scenario-holdout' : ''}
                          >
                            <td className="si-scenario-expand-cell">
                              <button
                                type="button"
                                className="si-expand-btn"
                                aria-expanded={expanded}
                                aria-label={`${expanded ? 'Collapse' : 'Expand'} details for ${s.name}`}
                                onClick={() =>
                                  setExpandedId(expanded ? null : s.id)
                                }
                              >
                                {expanded ? '▾' : '▸'}
                              </button>
                            </td>
                            <td className="si-scenario-id">#{s.id}</td>
                            <td>
                              <div className="si-scenario-name-cell">
                                <strong>{s.name}</strong>
                                <span className="si-badge">
                                  {s.holdout === 1 ? 'held-out' : 'training'}
                                </span>
                              </div>
                            </td>
                            <td className="si-scenario-input" title={s.input}>
                              {s.input
                                ? s.input.slice(0, 60) +
                                  (s.input.length > 60 ? '…' : '')
                                : '—'}
                            </td>
                            <td className="si-scenario-checks">
                              <div className="si-check-chip-list">
                                {checks.length === 0
                                  ? '—'
                                  : checks.slice(0, 2).map((check, index) => (
                                      <span
                                        key={index}
                                        className="si-check-chip"
                                      >
                                        {scenarioCheckLabel(check)}
                                      </span>
                                    ))}
                                {checks.length > 2 && (
                                  <span className="si-check-chip">
                                    +{checks.length - 2}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="si-scenario-date">
                              {s.created_at.slice(0, 10)}
                            </td>
                            <td>
                              <MenuRoot>
                                <MenuTrigger
                                  className="si-row-menu-trigger"
                                  aria-label={`Actions for ${s.name}`}
                                >
                                  ···
                                </MenuTrigger>
                                <MenuContent align="end">
                                  <MenuItem
                                    className="text-[var(--theme-danger,#ff5f6d)]"
                                    onClick={() => setDeleteTarget(s)}
                                  >
                                    Delete scenario
                                  </MenuItem>
                                </MenuContent>
                              </MenuRoot>
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="si-scenario-detail-row">
                              <td colSpan={7}>
                                <div className="si-scenario-detail">
                                  <div className="si-scenario-detail-meta">
                                    <span className="si-badge">
                                      {s.holdout === 1
                                        ? 'held-out'
                                        : 'training'}
                                    </span>
                                    <span>
                                      Created {s.created_at.slice(0, 10)}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="si-scenario-detail-label">
                                      Input
                                    </span>
                                    <pre className="si-scenario-detail-input">
                                      {s.input || '—'}
                                    </pre>
                                  </div>
                                  <div>
                                    <span className="si-scenario-detail-label">
                                      Checks ({checks.length})
                                    </span>
                                    {checks.length === 0 ? (
                                      <span className="si-empty-sub">
                                        No checks
                                      </span>
                                    ) : (
                                      <div className="si-check-chip-list si-check-chip-list--wrap">
                                        {checks.map((check, index) => (
                                          <span
                                            key={index}
                                            className="si-check-chip"
                                          >
                                            {scenarioCheckLabel(check)}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <ScenarioWizard
              open={createOpen}
              profile={profile}
              pending={createMutation.isPending}
              error={
                createMutation.error instanceof Error
                  ? createMutation.error.message
                  : createMutation.isError
                    ? 'Failed to create scenario'
                    : null
              }
              onOpenChange={(open) => {
                if (!open) createMutation.reset()
                setCreateOpen(open)
              }}
              onCreate={(payload) => createMutation.mutate(payload)}
            />

            {/* Delete confirm */}
            <ScenarioDeleteDialog
              open={deleteTarget !== null}
              scenarioName={deleteTarget?.name ?? 'this scenario'}
              scenarioId={deleteTarget?.id ?? null}
              pending={deleteMutation.isPending}
              onConfirm={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
              }}
              onCancel={() => setDeleteTarget(null)}
            />
          </div>
        </details>
      )}
    </div>
  )
}

// ── Status summary section (StatusSummary card + controls cluster) ──────────

type SelfImproveTab = 'run' | 'evaluation'

// Where each next-step sends the user. 'collect' fires the mutation in place;
// null keys have no in-app destination (bootstrap is a CLI action, healthy is
// terminal) so the next-step stays a static label for them.
export const NEXT_STEP_TAB: Record<NextStep['key'], SelfImproveTab | null> = {
  bootstrap: null,
  'add-training': 'evaluation',
  'add-holdout': 'evaluation',
  collect: 'run',
  propose: 'run',
  review: 'run',
  apply: 'run',
  observe: 'run',
  verify: 'run',
  baseline: 'run',
  healthy: null,
}

interface StatusSummarySectionProps {
  profile: string
  health: PluginHealth | undefined
  nextStep: NextStep
  onShowTab: (tab: SelfImproveTab) => void
}

function StatusSummarySection({
  profile,
  health,
  nextStep,
  onShowTab,
}: StatusSummarySectionProps) {
  const queryClient = useQueryClient()

  const statusQuery = useQuery({
    queryKey: ['self-improve', 'profile-status', profile],
    queryFn: () => fetchProfileStatus(profile),
    enabled: !!profile,
    refetchInterval: REFETCH_INTERVAL,
  })

  const invalidateStatus = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['self-improve', 'profile-status', profile],
    })
  }, [queryClient, profile])

  const collectMutation = useMutation({
    mutationFn: () => triggerCollect(profile),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['self-improve'] })
      toast(
        `Collected ${data.collected} snapshot${data.collected !== 1 ? 's' : ''}`,
      )
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Collect failed', {
        type: 'error',
      }),
  })

  const pauseMutation = useMutation({
    mutationFn: () => pauseProfile(profile),
    onSuccess: () => {
      invalidateStatus()
      toast(`Paused self-improve for "${profile}"`)
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Pause failed', { type: 'error' }),
  })

  const resumeMutation = useMutation({
    mutationFn: () => resumeProfile(profile),
    onSuccess: () => {
      invalidateStatus()
      toast(`Resumed self-improve for "${profile}"`)
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Resume failed', {
        type: 'error',
      }),
  })

  const status = statusQuery.data
  const paused = status?.paused ?? false
  const busy = pauseMutation.isPending || resumeMutation.isPending
  const statusUnavailable = statusQuery.isError || !status

  const nextStepTab = NEXT_STEP_TAB[nextStep.key]
  const nextStepActionable =
    nextStep.key === 'bootstrap' || nextStepTab !== null
  const handleNextStep = useCallback(() => {
    if (nextStep.key === 'collect') {
      if (!collectMutation.isPending && profile) collectMutation.mutate()
      return
    }
    if (nextStep.key === 'bootstrap') {
      const cmd = `hermes --profile ${profile} karpathy bootstrap`
      void navigator.clipboard.writeText(cmd)
      toast(`Copied: ${cmd} — run it in your terminal`)
      return
    }
    if (nextStepTab) {
      onShowTab(nextStepTab)
    }
  }, [nextStep.key, nextStepTab, collectMutation, onShowTab, profile])

  return (
    <div className="si-overview-summary" id="si-summary-anchor">
      <StatusSummary
        profile={profile}
        health={health}
        status={status}
        nextStep={nextStep}
        onNextStepAction={nextStepActionable ? handleNextStep : undefined}
      >
        <button
          type="button"
          className="si-collect-btn"
          disabled={collectMutation.isPending || !profile}
          onClick={() => collectMutation.mutate()}
        >
          {collectMutation.isPending ? 'Collecting…' : 'Collect now'}
        </button>
        <button
          type="button"
          className="si-action-btn"
          disabled={busy || statusUnavailable || paused || !profile}
          onClick={() => pauseMutation.mutate()}
        >
          {pauseMutation.isPending ? 'Pausing…' : 'Pause'}
        </button>
        <button
          type="button"
          className="si-action-btn si-action-btn--approve"
          disabled={busy || statusUnavailable || !paused || !profile}
          onClick={() => resumeMutation.mutate()}
        >
          {resumeMutation.isPending ? 'Resuming…' : 'Resume'}
        </button>
      </StatusSummary>

      {health && !health.db_exists && (
        <div className="si-health-state si-health-state--error" role="alert">
          Plugin DB missing — collected metrics and experiments cannot persist.
        </div>
      )}

      {statusQuery.isError && (
        <div className="si-config-error" role="alert">
          <span>
            {statusQuery.error instanceof Error
              ? statusQuery.error.message
              : 'Failed to load profile status'}
          </span>
          <button
            type="button"
            className="si-retry-btn"
            onClick={() => void statusQuery.refetch()}
          >
            Retry
          </button>
        </div>
      )}

      {status?.configured === false && (
        <p className="si-config-hint">
          Not bootstrapped? Run:{' '}
          <code>
            hermes --profile {profile || '<profile>'} karpathy bootstrap
          </code>
        </p>
      )}
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
  const [activeTab, setActiveTab] = useState<SelfImproveTab>('run')
  const [selectedExperimentId, setSelectedExperimentId] = useState<
    number | null
  >(null)
  const [scenarioView, setScenarioView] = useState<ScenarioView>('library')
  const [resultKind, setResultKind] = useState<EvaluationRunKind>('offline')

  useEffect(() => {
    if (agentProfiles.length > 0) {
      setProfile((current) =>
        selectAvailableProfile(current, activeProfile, agentProfiles),
      )
    }
  }, [activeProfile, agentProfiles])

  useEffect(() => {
    setSelectedExperimentId(null)
    setScenarioView('library')
    setResultKind('offline')
  }, [profile])

  // Dismissible intro card — persisted to localStorage
  const [introDismissed, setIntroDismissed] = useState(
    typeof window !== 'undefined' &&
      window.localStorage.getItem('si-intro-dismissed') === 'true',
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

  // Shared profile-status/experiment keys are deduped by React Query.
  // dedupes by key, so these add no extra network requests.
  const statusQuery = useQuery({
    queryKey: ['self-improve', 'profile-status', profile],
    queryFn: () => fetchProfileStatus(profile),
    enabled: !!profile,
    refetchInterval: REFETCH_INTERVAL,
  })

  const experimentsQuery = useQuery({
    queryKey: ['self-improve', 'experiments', 'all', profile],
    queryFn: () => fetchExperiments({ profile }),
    enabled: !!profile,
    refetchInterval: REFETCH_INTERVAL,
  })

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['self-improve'] })
  }, [queryClient])

  const isLoading =
    latestQuery.isLoading || historyQuery.isLoading || baselinesQuery.isLoading
  const isError =
    latestQuery.isError || historyQuery.isError || baselinesQuery.isError
  const errorMsg =
    (latestQuery.error instanceof Error ? latestQuery.error.message : null) ??
    (historyQuery.error instanceof Error ? historyQuery.error.message : null) ??
    (baselinesQuery.error instanceof Error
      ? baselinesQuery.error.message
      : null) ??
    'Failed to load'

  const snapshots = latestQuery.data ?? []
  const history = historyQuery.data ?? []
  const baselines = baselinesQuery.data ?? []

  // The metrics snapshot for the currently-selected profile
  const activeSnapshot = snapshots.find((s) => s.profile === profile) ?? null

  // Dependency-chain guidance — drives the summary line and every empty state
  const nextStep = computeNextStep({
    status: statusQuery.data,
    hasMetrics: activeSnapshot !== null,
    experiments: experimentsQuery.data ?? [],
  })

  const experiments = (experimentsQuery.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  const selectExperiment = useCallback((id: number) => {
    setSelectedExperimentId(id)
  }, [])
  const showExperiment = useCallback((id: number) => {
    setSelectedExperimentId(id)
    setActiveTab('run')
  }, [])
  const showScenarioResults = useCallback((kind: EvaluationRunKind) => {
    setResultKind(kind)
    setScenarioView('results')
    setActiveTab('evaluation')
  }, [])

  return (
    <div className="si-screen">
      {/* ── Dismissible intro card (FIX 5) ── */}
      {!introDismissed && (
        <div className="si-intro-card">
          <span className="si-intro-text">
            This page lets the agent propose one small edit to a profile's
            instructions, test it against behavior scenarios (graded by a
            different model), and keep it only if it scores better — with your
            approval. Every applied change has a rollback snapshot; Git audit
            commits are best-effort.
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
          <div className="si-title-copy">
            <span className="si-page-kicker">Autonomous evaluation</span>
            <h1 className="si-title">Self-Improve</h1>
            <p className="si-page-subtitle">
              Measure behavior, test one controlled change, and promote only
              verified improvements.
            </p>
          </div>
        </div>
        {healthQuery.isLoading && (
          <div className="si-health-state">Checking plugin health…</div>
        )}
        {healthQuery.isError && (
          <div className="si-health-state si-health-state--error" role="alert">
            <span>
              {healthQuery.error instanceof Error
                ? healthQuery.error.message
                : 'Failed to load plugin health'}
            </span>
            <button
              type="button"
              className="si-retry-btn"
              onClick={() => void healthQuery.refetch()}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as SelfImproveTab)}
        className="si-tabs"
      >
        <div className="si-tabbar">
          <TabsList variant="underline" aria-label="Self-Improve sections">
            <TabsTrigger value="run">Run</TabsTrigger>
            <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
          </TabsList>
          <ProfileScopeSelect
            value={profile}
            onChange={setProfile}
            profiles={agentProfiles}
          />
        </div>

        <TabsContent value="run">
          <section className="si-run-section">
            <StatusSummarySection
              profile={profile}
              health={healthQuery.data}
              nextStep={nextStep}
              onShowTab={setActiveTab}
            />
            <RunKpis status={statusQuery.data} experiments={experiments} />

            {experimentsQuery.isLoading ? (
              <section className="si-experiment-log-section">
                <div className="si-loading">Loading experiment log…</div>
              </section>
            ) : experimentsQuery.isError ? (
              <section className="si-experiment-log-section">
                <div className="si-error-msg">
                  Failed to load experiment log.
                  <button
                    type="button"
                    className="si-retry-btn"
                    onClick={() => void experimentsQuery.refetch()}
                  >
                    Retry
                  </button>
                </div>
              </section>
            ) : (
              <ExperimentLog
                experiments={experiments}
                selectedExperimentId={selectedExperimentId}
                onSelect={showExperiment}
              />
            )}

            {selectedExperimentId !== null && (
              <ExperimentReview
                profile={profile}
                baselines={baselines}
                status={statusQuery.data}
                nextStep={nextStep}
                onMutated={invalidateAll}
                selectedExperimentId={selectedExperimentId}
                onSelectExperiment={selectExperiment}
                onShowResults={showScenarioResults}
              />
            )}

            <details className="si-run-diagnostics">
              <summary>Run diagnostics</summary>
              <div className="si-run-diagnostics-body">
                {isLoading ? (
                  <SkeletonCards />
                ) : isError ? (
                  <div className="si-error-state">
                    <p className="si-error-msg">{errorMsg}</p>
                    <button
                      type="button"
                      className="si-retry-btn"
                      onClick={invalidateAll}
                    >
                      Retry
                    </button>
                  </div>
                ) : activeSnapshot !== null ? (
                  <div className="si-cards-grid si-cards-grid--single">
                    <ProfileCard
                      snapshot={activeSnapshot}
                      history={history}
                      baselines={baselines}
                    />
                  </div>
                ) : (
                  <div className="si-empty-state si-overview-empty">
                    <p>No metrics collected for {profile || 'this profile'}.</p>
                    <p className="si-empty-sub">
                      Metrics are log-window signals, not behavior scores. Next:{' '}
                      <strong>{nextStep.label}</strong> — {nextStep.hint}
                    </p>
                  </div>
                )}
              </div>

              <div className="si-baseline-chart-section">
                <div className="si-section-header">
                  <div>
                    <span className="si-section-eyebrow">Quality signal</span>
                    <h2 className="si-section-title">Baseline Curve</h2>
                  </div>
                </div>
                <p className="si-section-caption">
                  Fraction of behavior scenarios passed. Higher is better.
                </p>
                {baselines.filter((baseline) => baseline.profile === profile)
                  .length > 1 ? (
                  <BaselineChart baselines={baselines} profile={profile} />
                ) : (
                  <div className="si-empty-state">
                    <p>Not enough verified baseline points to chart yet.</p>
                    <p className="si-empty-sub">
                      A baseline is written after daemon verification. Next:{' '}
                      <strong>{nextStep.label}</strong> — {nextStep.hint}
                    </p>
                  </div>
                )}
              </div>
            </details>
          </section>
        </TabsContent>

        <TabsContent value="evaluation">
          <div id="si-scenarios-anchor" style={{ scrollMarginTop: '16px' }}>
            <ScenarioSection
              profile={profile}
              nextStep={nextStep}
              experiments={experiments}
              selectedExperimentId={selectedExperimentId}
              onSelectExperiment={selectExperiment}
              view={scenarioView}
              onViewChange={setScenarioView}
              resultKind={resultKind}
              onResultKindChange={setResultKind}
              onShowExperiment={() => setActiveTab('run')}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
