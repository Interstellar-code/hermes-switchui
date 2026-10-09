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

const OPS_PERIODS: Array<OpsPeriod> = [7, 14, 30]

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
  className,
}: {
  overview: DashboardOverview | null
  period: OpsPeriod
  onPeriodChange: (p: OpsPeriod) => void
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
          all profiles
        </span>
        <span className="grow" />
        <div
          className="inline-flex items-center overflow-hidden rounded border"
          style={{ borderColor: 'var(--theme-border)' }}
          role="group"
          aria-label="Analytics period"
        >
          {OPS_PERIODS.map((p) => {
            const active = p === period
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active}
                onClick={() => onPeriodChange(p)}
                className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] transition-colors"
                style={{
                  background: active
                    ? 'color-mix(in srgb, var(--theme-accent) 18%, transparent)'
                    : 'transparent',
                  color: active ? 'var(--theme-accent)' : 'var(--theme-muted)',
                  borderRight:
                    p !== OPS_PERIODS[OPS_PERIODS.length - 1]
                      ? '1px solid var(--theme-border)'
                      : 'none',
                }}
              >
                {p}D
              </button>
            )
          })}
        </div>
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
                installedCount={0}
                onOpen={() => undefined}
              />
            </div>
          ) : null}
          {layout.isVisible('token_mix_hour') ? (
            <div className="lg:col-span-4">
              <TokenMixHourCard
                analytics={overview?.analytics ?? null}
                sessions={[]}
              />
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
