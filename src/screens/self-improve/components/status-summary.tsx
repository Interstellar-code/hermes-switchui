import type { ReactNode } from 'react'
import type { PluginHealth, ProfileStatus } from '@/lib/self-improve-types'
import type { NextStep } from '@/lib/self-improve-next-step'
import './status-summary.css'

interface StatusSummaryProps {
  profile: string
  health: PluginHealth | undefined
  status: ProfileStatus | undefined
  nextStep: NextStep | undefined
  /** When provided, the next-step line becomes a button that runs this. */
  onNextStepAction?: () => void
  children?: ReactNode
}

type DotTone = 'ok' | 'warn' | 'dim'

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function Pill({ tone, label }: { tone: DotTone; label: string }) {
  return (
    <span className="si-summary-pill">
      <span className={`si-summary-dot si-summary-dot--${tone}`} />
      {label}
    </span>
  )
}

function pluginPill(health: PluginHealth | undefined) {
  if (!health) return { tone: 'dim' as const, label: 'Plugin unknown' }
  if (health.ok)
    return { tone: 'ok' as const, label: `Plugin healthy (v${health.version})` }
  return { tone: 'warn' as const, label: 'Plugin unavailable' }
}

function profilePill(status: ProfileStatus | undefined) {
  if (status?.configured === true)
    return {
      tone: 'ok' as const,
      label: `Profile configured → ${status.target_relpath ?? '?'}`,
    }
  if (status?.configured === false)
    return { tone: 'warn' as const, label: 'Not configured — bootstrap needed' }
  return { tone: 'dim' as const, label: 'Config unknown' }
}

function loopPill(status: ProfileStatus | undefined) {
  if (status?.paused === true)
    return { tone: 'warn' as const, label: 'Loop paused' }
  if (status?.paused === false)
    return { tone: 'ok' as const, label: 'Loop active' }
  return { tone: 'dim' as const, label: 'Loop unknown' }
}

export function StatusSummary({
  profile,
  health,
  status,
  nextStep,
  onNextStepAction,
  children,
}: StatusSummaryProps) {
  const plugin = pluginPill(health)
  const prof = profilePill(status)
  const loop = loopPill(status)

  const scenarioCounts = status?.scenario_counts
  const experimentCounts = status?.experiment_counts
  const experimentTotal = experimentCounts
    ? Object.values(experimentCounts).reduce((sum, n) => sum + n, 0)
    : undefined
  const baseline = status?.latest_baseline_score

  return (
    <div className="si-summary">
      <div className="si-summary-header">
        <span className="si-summary-profile">{profile}</span>
        {children && <div className="si-summary-controls">{children}</div>}
      </div>

      <div className="si-summary-pills">
        <Pill tone={plugin.tone} label={plugin.label} />
        <Pill tone={prof.tone} label={prof.label} />
        <Pill tone={loop.tone} label={loop.label} />
      </div>

      <div className="si-summary-counts">
        Scenarios {scenarioCounts ? scenarioCounts.train : 'none'} train /{' '}
        {scenarioCounts ? scenarioCounts.holdout : '0'} held-out · Baseline{' '}
        {baseline != null ? baseline.toFixed(2) : 'none'} · Experiments{' '}
        {experimentTotal ?? '0'}
      </div>

      {nextStep &&
        (onNextStepAction ? (
          <button
            type="button"
            className="si-summary-next-step si-summary-next-step--action"
            onClick={onNextStepAction}
          >
            <span className="si-summary-next-step-tag">Next step</span>
            <span className="si-summary-next-step-body">
              <strong>{nextStep.label}</strong> — {nextStep.hint}
            </span>
            <span className="si-summary-next-step-go" aria-hidden="true">
              →
            </span>
          </button>
        ) : (
          <div className="si-summary-next-step">
            <span className="si-summary-next-step-tag">Next step</span>
            <span className="si-summary-next-step-body">
              <strong>{nextStep.label}</strong> — {nextStep.hint}
            </span>
          </div>
        ))}

      <div className="si-summary-freshness">
        Freshness: collected {relativeTime(status?.last_collection_at)} ·
        proposed {relativeTime(status?.last_proposal_at)} · verified{' '}
        {relativeTime(status?.last_verification_at)}
        {status && (
          <details className="si-summary-details">
            <summary>config details ▸</summary>
            <div className="si-summary-details-body">
              <div>profile_root: {status.profile_root ?? '—'}</div>
              <div>proposer_model: {status.proposer_model ?? '—'}</div>
              <div>judge_model: {status.judge_model ?? '—'}</div>
              <div>
                live_sessions_target: {status.live_sessions_target ?? '—'}
              </div>
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
