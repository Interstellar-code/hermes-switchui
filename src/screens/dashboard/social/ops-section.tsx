import { useEffect, useRef, useState } from 'react'
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
import { CardPlaceholder } from '@/screens/dashboard/components/widget-shell'
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

/**
 * Wrapping flex row: a short last row grows to full width, cards in a row
 * share one height. The card fills its cell; one column below 300px.
 */
const CELL = 'flex min-w-[min(100%,300px)] flex-[1_1_300px] *:min-w-0 *:flex-1'
/** The usage chart takes two cards' worth of a row. */
const CELL_WIDE =
  'flex min-w-[min(100%,300px)] flex-[2_1_600px] *:min-w-0 *:flex-1'

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
  loading,
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
  /** Overview query still pending — analytics cards show "Loading…". */
  loading?: boolean
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

  const editRef = useRef<HTMLButtonElement>(null)
  const sectionRef = useRef<HTMLElement>(null)

  // Opened from anywhere (header pencil too): bring the panel into view.
  useEffect(() => {
    const el = sectionRef.current
    // jsdom has no scrollIntoView.
    if (layout.editMode && typeof el?.scrollIntoView === 'function')
      el.scrollIntoView({ block: 'nearest' })
  }, [layout.editMode])

  return (
    <section
      ref={sectionRef}
      className={className}
      aria-labelledby="ops-heading"
    >
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
          ref={editRef}
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

      {layout.editMode ? (
        <EditModePanel
          layout={layout}
          widgetIds={OPS_WIDGET_IDS}
          returnFocusTo={editRef}
          className="mt-3"
        />
      ) : null}

      {open ? (
        <div className="mt-3">
          <div id="ops-grid" className="ops flex flex-wrap items-stretch gap-3">
            {layout.isVisible('analytics_chart') ? (
              <div className={CELL_WIDE}>
                <AnalyticsChartCard
                  analytics={overview?.analytics ?? null}
                  insights={overview?.insights ?? []}
                  period={period}
                  onPeriodChange={onPeriodChange}
                  loading={loading}
                />
              </div>
            ) : null}
            {layout.isVisible('top_models') ? (
              <div className={CELL}>
                <TopModelsCard
                  analytics={overview?.analytics ?? null}
                  loading={loading}
                />
              </div>
            ) : null}
            {layout.isVisible('cache_efficiency') ? (
              <div className={CELL}>
                <CacheEfficiencyCard
                  analytics={overview?.analytics ?? null}
                  loading={loading}
                />
              </div>
            ) : null}
            {layout.isVisible('skills_usage') ? (
              <div className={CELL}>
                <SkillsUsageCard
                  usage={overview?.skillsUsage ?? null}
                  installedCount={installedCount}
                  onOpen={() => undefined}
                />
              </div>
            ) : null}
            {layout.isVisible('token_mix_hour') ? (
              <div className={CELL}>
                {hourHistogram && hourHistogram.length === 24 ? (
                  <TokenMixHourCard
                    analytics={overview?.analytics ?? null}
                    sessions={sessionsFromHistogram(hourHistogram)}
                  />
                ) : (
                  <CardPlaceholder
                    title="Tokens by hour"
                    state="unavailable"
                    message="Hour-of-day session data not loaded yet."
                  />
                )}
              </div>
            ) : null}
            {layout.isVisible('provider_mix') ? (
              <div className={CELL}>
                <ProviderMixCard analytics={overview?.analytics ?? null} />
              </div>
            ) : null}
            {layout.isVisible('velocity') ? (
              <div className={CELL}>
                <VelocityCard analytics={overview?.analytics ?? null} />
              </div>
            ) : null}
            {layout.isVisible('cost_ledger') ? (
              <div className={CELL}>
                <CostLedgerCard analytics={overview?.analytics ?? null} />
              </div>
            ) : null}
            {layout.isVisible('operator_tip') ? (
              <div className={CELL}>
                <OperatorTipCard overview={overview ?? null} />
              </div>
            ) : null}
            {layout.isVisible('logs_tail') ? (
              <div className={CELL}>
                <LogsTailCard logs={overview?.logs ?? null} />
              </div>
            ) : null}
          </div>
        </div>
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
