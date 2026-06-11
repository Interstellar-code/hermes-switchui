'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Baseline, MetricsSnapshot, PluginHealth } from '@/lib/self-improve-types'
import { toast } from '@/components/ui/toast'
import {
  fetchBaselines,
  fetchHealth,
  fetchLatestMetrics,
  fetchMetrics,
  triggerCollect,
} from '@/lib/self-improve-api'
import './self-improve-screen.css'

// ── Query keys ────────────────────────────────────────────────────────────────

const QK_HEALTH = ['self-improve', 'health'] as const
const QK_LATEST = ['self-improve', 'metrics-latest'] as const
const QK_HISTORY = ['self-improve', 'metrics-history'] as const
const QK_BASELINES = ['self-improve', 'baselines'] as const

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
    </div>
  )
}
