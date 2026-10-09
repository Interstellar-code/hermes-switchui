import { useEffect, useMemo, useState } from 'react'
import type { DashboardOverview } from '@/server/dashboard-aggregator'
import type { WidgetId } from '@/screens/dashboard/lib/use-dashboard-layout'
import { AnalyticsChartCard } from '@/screens/dashboard/components/analytics-chart-card'
import { TopModelsCard } from '@/screens/dashboard/components/top-models-card'
import { CacheEfficiencyCard } from '@/screens/dashboard/components/cache-efficiency-card'
import { SkillsUsageCard } from '@/screens/dashboard/components/skills-usage-card'
import { TokenMixHourCard } from '@/screens/dashboard/components/token-mix-hour-card'
import { ProviderMixCard } from '@/screens/dashboard/components/provider-mix-card'
import { VelocityCard } from '@/screens/dashboard/components/velocity-card'
import { CostLedgerCard } from '@/screens/dashboard/components/cost-ledger-card'
import { OperatorTipCard } from '@/screens/dashboard/components/operator-tip-card'
import { LogsTailCard } from '@/screens/dashboard/components/logs-tail-card'
import { EditModePanel } from '@/screens/dashboard/components/edit-mode-panel'
import { useDashboardLayout } from '@/screens/dashboard/lib/use-dashboard-layout'

export type OpsPeriod = 7 | 14 | 30

const OPS_OPEN_KEY = 'dashboard.ops.open'

/**
 * The 10 widget ids the ops grid knows about. We pull from the
 * shared `WidgetId` union so the EDIT LAYOUT button can reuse the
 * existing `EditModePanel` without teaching it a parallel list.
 */
const OPS_WIDGET_IDS: ReadonlyArray<WidgetId> = [
  'analytics_chart',
  'top_models',
  'cache_efficiency',
  'skills_usage',
  'token_mix_hour',
  'provider_mix',
  'velocity',
  'cost_ledger',
  'operator_tip',
  'logs_tail',
]

type OpsWidgetId = (typeof OPS_WIDGET_IDS)[number]

/** Human label per widget id for the "N cards hidden" footer. */
const LABEL_BY_ID: Partial<Record<OpsWidgetId, string>> = {
  analytics_chart: 'analytics chart',
  top_models: 'top models',
  cache_efficiency: 'cache efficiency',
  skills_usage: 'skills usage',
  token_mix_hour: 'tokens by hour',
  provider_mix: 'provider mix',
  velocity: 'velocity',
  cost_ledger: 'cost ledger',
  operator_tip: 'operator tips',
  logs_tail: 'logs tail',
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === 'true') return true
    if (raw === 'false') return false
    return fallback
  } catch {
    return fallback
  }
}

/**
 * OPS & ANALYTICS section — the lower analytics band of the social
 * dashboard. Owns its own open/close state, its own period, and the
 * grid of analytics cards (5 default + 5 opt-in).
 *
 * Phase C of the dashboard revamp. The screen this eventually mounts
 * into is still the old layout; today the section compiles and tests
 * cleanly but the dashboard renders without it. P2 swaps it in.
 */
export function OpsSection({
  overview,
  period,
  onPeriodChange,
  installedCount,
  hourHistogram,
  className,
}: {
  overview: DashboardOverview | null
  period: OpsPeriod
  onPeriodChange: (p: OpsPeriod) => void
  /**
   * Number of installed skills, used by `SkillsUsageCard` for the
   * "N of M used" denominator. P2 passes the same value today's
   * `dashboard-screen.tsx:361` derives from the
   * `['dashboard','skills-count']` query
   * (`/api/skills?tab=installed&limit=200&summary=search`). `null`
   * means "we don't know yet" and the card renders "—".
   */
  installedCount?: number | null
  /**
   * Pre-computed 24-bucket session count per hour-of-day for the
   * "Tokens by hour" card. P2 derives this from the same session
   * rows the legacy screen feeds `TokenMixHourCard`. `null` /
   * `undefined` means we don't have session data yet — the
   * "Tokens by hour" tile renders an Unavailable state with the
   * correct title rather than mounting the legacy card with an
   * empty hour strip (which would render as "Mix & rhythm" and
   * disagree with the catalog description).
   */
  hourHistogram?: ReadonlyArray<{ hour: number; count: number }> | null
  className?: string
}) {
  // Open/close state. Persists per the spec: `dashboard.ops.open`,
  // default open. Pinned to the layout hook so the same persistence
  // shape (per-tab localStorage) handles both visibility and edit
  // mode toggles consistently.
  const [open, setOpen] = useState<boolean>(() => readBool(OPS_OPEN_KEY, true))

  // The shared `useDashboardLayout` already hides the 5 default-off
  // ids (`provider_mix`, `velocity`, `cost_ledger`, `operator_tip`,
  // `logs_tail`) via `DEFAULT_HIDDEN` — they're shared with the
  // legacy screen. No per-section seeding is needed; the ops grid
  // renders with those cards hidden on first paint, and the user
  // can opt them in via the EDIT LAYOUT button.
  const layout = useDashboardLayout()

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(OPS_OPEN_KEY, open ? 'true' : 'false')
    } catch {
      /* quota / disabled storage — non-fatal */
    }
  }, [open])

  // Pull the count of currently-hidden ops cards so the footer can
  // name them by their friendly label. Sorted by the catalog order
  // so the listing is stable across re-renders.
  const hiddenIds = useMemo<Array<OpsWidgetId>>(() => {
    return OPS_WIDGET_IDS.filter((id) => !layout.isVisible(id))
  }, [layout])

  const hiddenLabel = useMemo(
    () => hiddenIds.map((id) => LABEL_BY_ID[id] ?? id).join(', '),
    [hiddenIds],
  )

  return (
    <section className={className} aria-labelledby="ops-heading">
      <div
        className="opsh flex flex-wrap items-center gap-2.5 border-t pt-3.5"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <h2
          id="ops-heading"
          className="text-[10px] font-extrabold tracking-[0.16em]"
          style={{ color: 'var(--theme-text)' }}
        >
          OPS &amp; ANALYTICS
        </h2>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.1em]"
          style={{ color: 'var(--theme-muted)' }}
        >
          all profiles · {period}D
        </span>
        <span className="grow" />
        <button
          type="button"
          onClick={layout.toggleEdit}
          aria-pressed={layout.editMode}
          className="rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] transition-colors hover:bg-[color-mix(in_srgb,var(--theme-card)_85%,transparent)]"
          style={{
            borderColor: layout.editMode
              ? 'var(--theme-accent)'
              : 'var(--theme-border)',
            color: layout.editMode
              ? 'var(--theme-accent)'
              : 'var(--theme-muted)',
          }}
        >
          EDIT LAYOUT
        </button>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="ops-grid"
          onClick={() => setOpen((v) => !v)}
          className="rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] transition-colors hover:bg-[color-mix(in_srgb,var(--theme-card)_85%,transparent)]"
          style={{
            borderColor: 'var(--theme-border)',
            color: 'var(--theme-muted)',
          }}
        >
          {open ? 'HIDE' : 'SHOW'}
        </button>
      </div>

      {layout.editMode ? <EditModePanel layout={layout} /> : null}

      {open ? (
        <div
          id="ops-grid"
          className="ops mt-3 grid grid-cols-1 gap-3 min-[390px]:grid-cols-1 lg:grid-cols-12"
        >
          {layout.isVisible('analytics_chart') ? (
            <div className="lg:col-span-8">
              <AnalyticsChartCard
                analytics={overview?.analytics ?? null}
                insights={overview?.insights ?? []}
                period={period}
                onPeriodChange={onPeriodChange}
                loading={false}
              />
            </div>
          ) : null}
          {layout.isVisible('top_models') ? (
            <div className="lg:col-span-4">
              <TopModelsCard analytics={overview?.analytics ?? null} />
            </div>
          ) : null}
          {layout.isVisible('cache_efficiency') ? (
            <div className="lg:col-span-4">
              <CacheEfficiencyCard analytics={overview?.analytics ?? null} />
            </div>
          ) : null}
          {layout.isVisible('skills_usage') ? (
            <div className="lg:col-span-4">
              <SkillsUsageCard
                usage={overview?.skillsUsage ?? null}
                installedCount={installedCount}
                onOpen={() => undefined}
              />
            </div>
          ) : null}
          {layout.isVisible('token_mix_hour') ? (
            <div className="lg:col-span-4">
              {hourHistogram && hourHistogram.length === 24 ? (
                <TokenMixHourCard
                  analytics={overview?.analytics ?? null}
                  sessions={sessionsFromHistogram(hourHistogram)}
                />
              ) : (
                <UnavailableTile
                  title="Tokens by hour"
                  message="Hour-of-day session data not loaded yet."
                />
              )}
            </div>
          ) : null}

          {layout.isVisible('provider_mix') ? (
            <div className="lg:col-span-4">
              <ProviderMixCard analytics={overview?.analytics ?? null} />
            </div>
          ) : null}
          {layout.isVisible('velocity') ? (
            <div className="lg:col-span-4">
              <VelocityCard analytics={overview?.analytics ?? null} />
            </div>
          ) : null}
          {layout.isVisible('cost_ledger') ? (
            <div className="lg:col-span-4">
              <CostLedgerCard analytics={overview?.analytics ?? null} />
            </div>
          ) : null}
          {layout.isVisible('operator_tip') ? (
            <div className="lg:col-span-4">
              <OperatorTipCard overview={overview ?? null} />
            </div>
          ) : null}
          {layout.isVisible('logs_tail') ? (
            <div className="lg:col-span-4">
              <LogsTailCard logs={overview?.logs ?? null} />
            </div>
          ) : null}
        </div>
      ) : null}

      {open && hiddenIds.length > 0 ? (
        <p
          className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]"
          style={{ color: 'var(--theme-muted)' }}
        >
          <span>
            {hiddenIds.length} card{hiddenIds.length === 1 ? '' : 's'} hidden:{' '}
            {hiddenLabel}.
          </span>
          <button
            type="button"
            onClick={layout.toggleEdit}
            aria-pressed={layout.editMode}
            className="rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] transition-colors hover:bg-[color-mix(in_srgb,var(--theme-card)_85%,transparent)]"
            style={{
              borderColor: 'var(--theme-border)',
              color: 'var(--theme-muted)',
            }}
          >
            EDIT LAYOUT
          </button>
        </p>
      ) : null}
    </section>
  )
}

/**
 * Map the 24-bucket hour histogram P2 supplies back into the
 * session rows the legacy `TokenMixHourCard` expects. We pin each
 * session to a fixed "now" so the card's hour-of-day bucketing is
 * deterministic — the histogram is already aggregated, so any
 * timestamp inside the bucket's hour would round-trip to the same
 * bucket the histogram was built from. We pick the canonical
 * 2026-01-01 date so test fixtures stay reproducible.
 */
function sessionsFromHistogram(
  histogram: ReadonlyArray<{ hour: number; count: number }>,
): Array<{ startedAt: number; updatedAt: number }> {
  const out: Array<{ startedAt: number; updatedAt: number }> = []
  for (const bucket of histogram) {
    if (bucket.count <= 0) continue
    if (bucket.hour < 0 || bucket.hour > 23) continue
    const ts = new Date(2026, 0, 1, bucket.hour, 0, 0, 0).getTime()
    for (let i = 0; i < bucket.count; i += 1) {
      out.push({ startedAt: ts, updatedAt: ts })
    }
  }
  return out
}

/**
 * Inline "data not loaded yet" tile for grid cells whose required
 * data hasn't been fetched. Mirrors the chrome of the existing
 * cards (rounded border, subtle gradient, muted text) so an empty
 * grid cell still looks like part of the dashboard rather than a
 * layout hole.
 */
function UnavailableTile({
  title,
  message,
}: {
  title: string
  message: string
}) {
  return (
    <div
      className="flex h-full min-h-[180px] flex-col gap-2 overflow-hidden rounded-xl border p-3"
      style={{
        background:
          'linear-gradient(150deg, color-mix(in srgb, var(--theme-card) 96%, transparent), color-mix(in srgb, var(--theme-card) 92%, transparent))',
        borderColor: 'var(--theme-border)',
      }}
    >
      <h3
        className="text-[10px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: 'var(--theme-text)' }}
      >
        {title}
      </h3>
      <div
        className="font-mono text-[11px] uppercase tracking-[0.15em]"
        style={{ color: 'var(--theme-muted)' }}
      >
        {message}
      </div>
    </div>
  )
}
