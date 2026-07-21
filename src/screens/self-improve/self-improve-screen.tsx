'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BaselineChart } from './components/baseline-chart'
import { ExperimentCard } from './components/experiment-card'
import { ProfileScopeSelect } from './components/profile-scope-select'
import { ScenarioDeleteDialog } from './components/scenario-delete-dialog'
import { ScenarioWizard } from './components/scenario-wizard'
import type {
  Baseline,
  MetricsSnapshot,
  PluginHealth,
  Scenario,
  ScenarioCheck,
} from '@/lib/self-improve-types'
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

// ── Health strip ──────────────────────────────────────────────────────────────

function HealthStrip({ health }: { health: PluginHealth }) {
  return (
    <div className="si-health-strip">
      <span
        className={`si-health-dot ${health.ok ? 'si-health-dot--ok' : 'si-health-dot--err'}`}
      />
      <span className="si-health-label">{health.plugin}</span>
      <span className="si-health-version">v{health.version}</span>
      <span className="si-health-sep">·</span>
      <span
        className={`si-health-db ${health.db_exists ? '' : 'si-health-db--missing'}`}
      >
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

  return (
    <div className="si-card">
      <div className="si-card-header">
        <span className="si-profile-name">{snapshot.profile}</span>
        <span className="si-captured-at">
          {relativeTime(snapshot.captured_at)}
        </span>
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
          <span className="si-metric-label">Error+Warn rate</span>
          <span className="si-metric-value">
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
          <span className="si-metric-label">Cost trend</span>
          <div className="si-metric-row">
            <span className="si-metric-value">{formatCost(snapshot.cost)}</span>
            {costDelta !== null && (
              <span
                className={`si-delta ${costDelta > 0 ? 'si-delta--up' : costDelta < 0 ? 'si-delta--down' : ''}`}
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

// ── Experiments feed (unified proposals + lifecycle) ─────────────────────────

interface ExperimentsFeedProps {
  profile: string
  baselines: Array<Baseline>
  onMutated: () => void
}

function ExperimentsFeed({
  profile,
  baselines,
  onMutated,
}: ExperimentsFeedProps) {
  const queryClient = useQueryClient()

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
  })

  const experiments = (experimentsQuery.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
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
            Click <strong>Propose</strong> to have the agent generate an
            improvement proposal.
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
  const [splitFilter, setSplitFilter] = useState<'all' | 'train' | 'holdout'>(
    'all',
  )
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Scenario | null>(null)

  const scenariosQK = qkScenarios(profile, true)

  const scenariosQuery = useQuery({
    queryKey: scenariosQK,
    queryFn: () => fetchScenarios(profile, true),
    enabled: !!profile,
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

  return (
    <div className="si-scenario-section">
      <div className="si-section-header">
        <h2 className="si-section-title">Scenarios</h2>
        <div className="si-scenario-controls">
          <div className="si-split-filter" aria-label="Filter scenario split">
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
        </div>
      </div>

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
        scenarios.length === 0 && (
          <div className="si-empty">
            <p>
              No scenarios for <strong>{profile}</strong>.
            </p>
            <p className="si-empty-sub">
              Create a scenario or choose another split.
            </p>
          </div>
        )}

      {scenarios.length > 0 && (
        <div className="si-table-scroll">
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
                <tr
                  key={s.id}
                  className={s.holdout ? 'si-scenario-holdout' : ''}
                >
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
                      ? s.input.slice(0, 60) + (s.input.length > 60 ? '…' : '')
                      : '—'}
                  </td>
                  <td className="si-scenario-checks">
                    <div className="si-check-chip-list">
                      {parseScenarioChecks(s.checks).length === 0
                        ? '—'
                        : parseScenarioChecks(s.checks)
                            .slice(0, 2)
                            .map((check, index) => (
                              <span key={index} className="si-check-chip">
                                {scenarioCheckLabel(check)}
                              </span>
                            ))}
                      {parseScenarioChecks(s.checks).length > 2 && (
                        <span className="si-check-chip">
                          +{parseScenarioChecks(s.checks).length - 2}
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
              ))}
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
  )
}

// ── Profile configuration panel ─────────────────────────────────────────────

function ProfileConfigPanel({ profile }: { profile: string }) {
  const queryClient = useQueryClient()

  const statusQuery = useQuery({
    queryKey: ['self-improve', 'profile-status', profile],
    queryFn: () => fetchProfileStatus(profile),
    enabled: !!profile,
    refetchInterval: REFETCH_INTERVAL,
  })

  // Reuses the ExperimentsFeed query (same key) — no extra request.
  const experimentsQuery = useQuery({
    queryKey: ['self-improve', 'experiments', 'all', profile],
    queryFn: () => fetchExperiments({ profile }),
    enabled: !!profile,
    refetchInterval: REFETCH_INTERVAL,
  })

  const invalidateStatus = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['self-improve', 'profile-status', profile],
    })
  }, [queryClient, profile])

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

  const paused = statusQuery.data?.paused ?? false
  const busy = pauseMutation.isPending || resumeMutation.isPending
  const statusUnavailable = statusQuery.isError || !statusQuery.data

  // Newest experiment for the selected profile → the file the ratchet edits.
  // noUncheckedIndexedAccess is OFF — guard with .length before indexing.
  const sortedExperiments = (experimentsQuery.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  const newest = sortedExperiments.length > 0 ? sortedExperiments[0] : null
  const targetRelpath = newest?.target_relpath ?? null
  const targetRoot = newest?.target_profile_root ?? null

  return (
    <div className="si-config-panel">
      <div className="si-config-row">
        <span className="si-config-label">Profile configuration</span>
        <span
          className={`si-config-status ${
            statusQuery.isError
              ? 'si-config-status--error'
              : paused
                ? 'si-config-status--paused'
                : 'si-config-status--running'
          }`}
        >
          {statusQuery.isLoading
            ? 'Checking…'
            : statusQuery.isError
              ? 'Unavailable'
              : paused
                ? 'Paused'
                : 'Running'}
        </span>
        <div className="si-config-actions">
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
        </div>
      </div>

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

      {targetRelpath ? (
        <div className="si-config-target">
          <span className="si-config-target-label">Target file</span>
          <code className="si-config-target-path">{targetRelpath}</code>
          {targetRoot && (
            <span className="si-config-target-root">in {targetRoot}</span>
          )}
        </div>
      ) : (
        <p className="si-config-hint">
          Not bootstrapped? Run:{' '}
          <code>
            hermes karpathy bootstrap --profile {profile || '<profile>'}
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

  useEffect(() => {
    if (agentProfiles.length > 0) {
      setProfile((current) =>
        selectAvailableProfile(current, activeProfile, agentProfiles),
      )
    }
  }, [activeProfile, agentProfiles])

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

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['self-improve'] })
  }, [queryClient])

  const collectMutation = useMutation({
    mutationFn: () => triggerCollect(profile),
    onSuccess: (data) => {
      invalidateAll()
      toast(
        `Collected ${data.collected} snapshot${data.collected !== 1 ? 's' : ''}`,
      )
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Collect failed', {
        type: 'error',
      }),
  })

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

  return (
    <div className="si-screen">
      {/* ── Dismissible intro card (FIX 5) ── */}
      {!introDismissed && (
        <div className="si-intro-card">
          <span className="si-intro-text">
            This page lets the agent propose one small edit to a profile's
            instructions, test it against behavior scenarios (graded by a
            different model), and keep it only if it scores better — with your
            approval. Each kept change is committed to git.
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
          <div className="si-header-controls">
            <ProfileScopeSelect
              value={profile}
              onChange={setProfile}
              profiles={agentProfiles}
            />
            <button
              type="button"
              className="si-collect-btn"
              disabled={collectMutation.isPending || !profile}
              onClick={() => collectMutation.mutate()}
            >
              {collectMutation.isPending ? 'Collecting…' : 'Collect now'}
            </button>
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
        {healthQuery.data && <HealthStrip health={healthQuery.data} />}
      </div>

      <section className="si-overview-section">
        <div className="si-section-heading">
          <div>
            <span className="si-section-eyebrow">Current profile</span>
            <h2 className="si-section-title">Overview</h2>
          </div>
          <span className="si-profile-context">{profile}</span>
        </div>

        <div className="si-overview-grid">
          <div className="si-overview-primary">
            <ProfileConfigPanel profile={profile} />
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
                  Collect the first snapshot to establish current behavior.
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
            {baselines.length > 0 ? (
              <BaselineChart baselines={baselines} profile={profile} />
            ) : (
              <div className="si-empty-state">
                <p>No verified baseline yet.</p>
                <p className="si-empty-sub">
                  Approve and verify an experiment to establish one.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Unified experiments feed (FIX 2) ── */}
      <ExperimentsFeed
        profile={profile}
        baselines={baselines}
        onMutated={invalidateAll}
      />

      {/* ── Scenario management — scoped to selected profile (FIX 1) ── */}
      <ScenarioSection profile={profile} />
    </div>
  )
}
