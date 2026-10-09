import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  BubbleChatAddIcon,
  CheckmarkCircle02Icon,
  ConsoleIcon,
  Edit02Icon,
  Moon02Icon,
  PuzzleIcon,
  Settings02Icon,
  Sun02Icon,
} from '@hugeicons/core-free-icons'
import { SetupChecklistCard } from './components/setup-checklist-card'
import { useDashboardLayout } from './lib/use-dashboard-layout'
import { AgentDialog } from './social/agent-dialog'
import { BadgeDialog } from './social/badge-dialog'
import { CenterColumn } from './social/center-column'
import { LeftColumn } from './social/left-column'
import { OpsSection } from './social/ops-section'
import { RightColumn } from './social/right-column'
import { StatusDock } from './social/status-dock'
import { useDashboardSocial } from './social/use-dashboard-social'
import type { AnalyticsPeriod } from './components/analytics-chart-card'
import type { DashboardOverview } from '@/server/dashboard-aggregator'
import type { DashboardSocial } from '@/types/dashboard-social'
import { useFeatureAvailable } from '@/hooks/use-feature-available'
import { openHamburgerMenu } from '@/components/mobile-hamburger-menu'
import { applyTheme, useStudioSettingsStore } from '@/hooks/use-settings'

// `IconSvgObject` isn't exported from @hugeicons/react; reuse the
// inferred type from a real icon import for prop typing.
type HugeIcon = typeof Settings02Icon

// ── Helpers ──────────────────────────────────────────────────────

function themeColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

function readDashboardPalette() {
  return {
    accent: themeColor('--theme-accent', '#6366f1'),
    accentSecondary: themeColor('--theme-accent-secondary', '#8b5cf6'),
    success: themeColor('--theme-success', '#22c55e'),
    warning: themeColor('--theme-warning', '#f59e0b'),
    danger: themeColor('--theme-danger', '#ef4444'),
    muted: themeColor('--theme-muted', '#6b7280'),
    border: themeColor('--theme-border', '#333333'),
    card: themeColor('--theme-card', '#1a1a2e'),
    text: themeColor('--theme-text', '#e5e7eb'),
  }
}

function useDashboardPalette() {
  const [palette, setPalette] = useState(readDashboardPalette)

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const refresh = () => setPalette(readDashboardPalette())
    refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style', 'class'],
    })
    return () => observer.disconnect()
  }, [])

  return palette
}

// Every slice null: the columns render "Unavailable" instead of numbers.
const UNAVAILABLE_SOCIAL: DashboardSocial = {
  profile: null,
  generatedAt: '',
  operator: null,
  agents: null,
  hotTopics: null,
  counts: null,
  needsYou: null,
  recent: null,
  badges: null,
}

// ── Secondary action (smaller, monochrome) ─────────────────────

function SecondaryAction({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string
  icon: HugeIcon
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-[0.05em] transition-all hover:scale-[1.015] hover:bg-[var(--theme-card)]/70 hover:text-[var(--theme-text)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        borderColor: 'var(--theme-border)',
        color: 'var(--theme-muted)',
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 80%, transparent), transparent)',
      }}
    >
      <HugeiconsIcon
        icon={icon}
        size={14}
        strokeWidth={1.6}
        className="transition-colors group-hover:text-[var(--theme-accent)]"
      />
      <span>{label}</span>
    </button>
  )
}

// ── Main Dashboard ───────────────────────────────────────────────

export function DashboardScreen() {
  const navigate = useNavigate()
  const sessionsAvailable = useFeatureAvailable('sessions')
  const skillsAvailable = useFeatureAvailable('skills')
  const sessionsQuery = useQuery({
    // Use a dedicated query key — NOT chatQueryKeys.sessions — to avoid
    // cache collisions with the chat sidebar which fetches fewer sessions
    // and overwrites the dashboard's larger dataset.
    // Also use the workspace proxy (/api/sessions) rather than the server-side
    // listSessions() — the latter calls the gateway via CLAUDE_API which is
    // only available server-side and returns nothing when called from the client.
    queryKey: ['dashboard', 'sessions'],
    queryFn: async () => {
      const res = await fetch('/api/sessions?limit=200&offset=0')
      if (!res.ok) return [] as Array<Record<string, unknown>>
      const data = (await res.json()) as {
        sessions?: Array<Record<string, unknown>>
      }
      return data.sessions ?? []
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
    enabled: sessionsAvailable,
  })

  // Sessions per local hour-of-day for the Ops "Tokens by hour" card. Same
  // bucketing as TokenMixHourCard (start time, else updated time).
  const hourHistogram = useMemo(() => {
    const counts = Array.from({ length: 24 }, () => 0)
    for (const s of sessionsQuery.data ?? []) {
      const ts = (s.startedAt ?? s.updatedAt) as number | undefined
      if (!ts) continue
      counts[new Date(ts).getHours()] += 1
    }
    return counts.map((count, hour) => ({ hour, count }))
  }, [sessionsQuery.data])

  // Skills count for the SkillsUsageCard sub-text. Cheap query, used
  // only for the "X of Y used" microcopy.
  const skillsCountQuery = useQuery({
    queryKey: ['dashboard', 'skills-count'],
    queryFn: async () => {
      const res = await fetch(
        '/api/skills?tab=installed&limit=200&summary=search',
      )
      if (!res.ok) return 0
      const data = (await res.json()) as {
        skills?: Array<unknown>
      }
      return data.skills?.length ?? 0
    },
    staleTime: 60_000,
    enabled: skillsAvailable,
  })
  const skillsInstalled = skillsCountQuery.data ?? 0

  // Per-user widget visibility + edit-mode state (localStorage backed).
  const layout = useDashboardLayout()

  // Period selector for analytics; persists across navigation via
  // localStorage so refreshes don't reset the operator's preference.
  const [period, setPeriod] = useState<AnalyticsPeriod>(() => {
    if (typeof window === 'undefined') return 30
    const stored = window.localStorage.getItem('dashboard.analyticsPeriod')
    const n = Number(stored)
    if (n === 7 || n === 14 || n === 30) return n
    return 30
  })
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('dashboard.analyticsPeriod', String(period))
    }
  }, [period])

  // Aggregate dashboard overview — surfaces the data the native
  // Hermes dashboard exposes (status, platforms, cron, achievements,
  // model info, analytics) in a single round trip with per-section
  // graceful fallbacks. Each card renders only when its slice resolves.
  const overviewQuery = useQuery<DashboardOverview>({
    queryKey: ['dashboard', 'overview', period],
    queryFn: async () => {
      // achievements=5 (instead of 3) gives the Achievements rail
      // card enough vertical mass to fill the gap below Top Models.
      const res = await fetch(
        `/api/dashboard/overview?days=${period}&achievements=5`,
      )
      if (!res.ok) throw new Error(`overview ${res.status}`)
      return (await res.json()) as DashboardOverview
    },
    staleTime: 5_000,
    refetchInterval: 30_000,
  })
  const overview = overviewQuery.data ?? null

  const palette = useDashboardPalette()

  const updateSettings = useStudioSettingsStore((state) => state.updateSettings)
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return true
    const dt = document.documentElement.getAttribute('data-theme') || ''
    return !dt.endsWith('-light')
  })

  const socialQuery = useDashboardSocial()
  const social = socialQuery.data ?? UNAVAILABLE_SOCIAL
  const [agentId, setAgentId] = useState<string | null>(null)
  const [badgesOpen, setBadgesOpen] = useState(false)
  const openAgent = social.agents?.find((a) => a.id === agentId) ?? null
  // The leaderboard metric lives inside RightColumn, so rank by weekly tokens.
  const openAgentRank = openAgent
    ? [...(social.agents ?? [])]
        .sort((a, b) => b.tokensWeek - a.tokensWeek)
        .findIndex((a) => a.id === openAgent.id) + 1
    : 0

  return (
    <div className="flex min-h-full flex-col">
      {/* Floating mobile nav: hamburger left, theme toggle right */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-2 h-12"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <button
          type="button"
          aria-label="Open navigation menu"
          onClick={openHamburgerMenu}
          className="flex items-center justify-center w-11 h-11 rounded-xl active:bg-white/10 transition-colors touch-manipulation"
        >
          <svg
            width="20"
            height="16"
            viewBox="0 0 20 16"
            fill="none"
            className="opacity-70"
            style={{ color: 'var(--color-ink, #111)' }}
          >
            <path
              d="M1 1.5H19M1 8H19M1 14.5H13"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={() => {
            const LIGHT_DARK_PAIRS: Record<string, string> = {
              'claude-nous': 'claude-nous-light',
              'claude-nous-light': 'claude-nous',
              'claude-official': 'claude-official-light',
              'claude-official-light': 'claude-official',
              'claude-classic': 'claude-classic-light',
              'claude-classic-light': 'claude-classic',
              'claude-slate': 'claude-slate-light',
              'claude-slate-light': 'claude-slate',
            }
            const cur =
              document.documentElement.getAttribute('data-theme') ||
              'claude-official'
            const nextDataTheme =
              LIGHT_DARK_PAIRS[cur] ||
              (isDark ? 'claude-official-light' : 'claude-official')
            import('@/lib/theme').then(({ setTheme }) => {
              setTheme(nextDataTheme as any)
            })
            const nextMode = nextDataTheme.endsWith('-light') ? 'light' : 'dark'
            applyTheme(nextMode)
            updateSettings({ theme: nextMode })
            setIsDark(nextMode === 'dark')
          }}
          className="flex items-center justify-center w-11 h-11 rounded-xl active:bg-white/10 transition-colors touch-manipulation"
          style={{ color: 'var(--theme-muted)' }}
        >
          <HugeiconsIcon
            icon={isDark ? Sun02Icon : Moon02Icon}
            size={20}
            strokeWidth={1.5}
          />
        </button>
      </div>
      <div className="flex min-h-full flex-1 flex-col gap-5 px-4 py-4 pt-14 pb-4 md:px-8 md:py-6 md:pt-4 lg:px-10">
        {/* ── Header: brand lockup left, action cluster right.
           Iteration 010: dropped redundant "Dashboard" eyebrow (the
           page IS the dashboard); promoted "Hermes Switch UI" to
           the primary heading at a larger weight. Logo bumped from
           36px → 44px and gets a soft accent glow + ring so the
           lockup commands the left side instead of feeling like
           filler before the action cluster. Kept anchored left
           (not centered) on purpose: ops dashboards put brand left
           + actions right because that's the spatial hierarchy
           operators expect (Linear, Vercel, Datadog all do this). */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span
              className="relative inline-flex shrink-0 items-center justify-center rounded-xl border"
              style={{
                width: 44,
                height: 44,
                borderColor:
                  'color-mix(in srgb, var(--theme-accent) 35%, var(--theme-border))',
                background:
                  'linear-gradient(135deg, color-mix(in srgb, var(--theme-accent) 14%, var(--theme-card)), var(--theme-card))',
                boxShadow:
                  '0 0 0 4px color-mix(in srgb, var(--theme-accent) 6%, transparent)',
              }}
            >
              <img
                src="/claude-avatar.webp"
                alt="Hermes Switch UI logo"
                className="size-8 rounded-md"
                style={{ background: 'transparent' }}
              />
            </span>
            {/* Iter 011: dropped the 'Operator console · vX.Y.Z'
              eyebrow. The gateway version is already on the OpsStrip
              (♦ GATEWAY V0.12.0), so the eyebrow was duplicating it.
              Single bold lockup feels cleaner; vertical centering on
              the lockup matches the height of the action cluster on
              the right so they don't visually drift. */}
            <div className="flex flex-col justify-center">
              <h1
                className="text-2xl font-bold tracking-tight"
                style={{
                  color: 'var(--theme-text)',
                  letterSpacing: '-0.015em',
                  lineHeight: 1.1,
                }}
              >
                Hermes Switch UI
              </h1>
            </div>
          </div>
          {/* Action row: hierarchy per Hermes Agent review.
           New Chat is primary (full button + accent), Terminal +
           Skills are secondary, Settings collapses to icon-only. */}
          <div className="flex w-full flex-wrap items-center justify-end gap-2 lg:max-w-xl">
            <button
              type="button"
              onClick={() =>
                navigate({
                  to: '/chat/$sessionKey',
                  params: { sessionKey: 'new' },
                })
              }
              className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg px-3.5 py-2 text-sm font-semibold uppercase tracking-[0.05em] transition-all hover:scale-[1.02] active:scale-[0.99]"
              style={{
                background: `linear-gradient(135deg, ${palette.accent}, ${palette.accentSecondary})`,
                color: 'var(--theme-on-accent, white)',
                boxShadow: `0 6px 18px -8px ${palette.accent}aa, inset 0 1px 0 0 rgba(255,255,255,0.18)`,
              }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(255,255,255,0.15), transparent 60%)',
                }}
              />
              <HugeiconsIcon
                icon={BubbleChatAddIcon}
                size={16}
                strokeWidth={1.8}
              />
              <span>New Chat</span>
            </button>
            <SecondaryAction
              label="Terminal"
              icon={ConsoleIcon}
              onClick={() => navigate({ to: '/terminal' })}
            />
            <SecondaryAction
              label="Skills"
              icon={PuzzleIcon}
              onClick={() => navigate({ to: '/skills' })}
              disabled={!skillsAvailable}
            />
            {/* Edit toggle: enters "layout edit mode" where each widget
              shows an X button and a banner appears for re-adding
              hidden widgets. Persisted to localStorage. */}
            <button
              type="button"
              aria-label={
                layout.editMode ? 'Done editing layout' : 'Edit layout'
              }
              title={layout.editMode ? 'Done editing layout' : 'Edit layout'}
              onClick={layout.toggleEdit}
              className="inline-flex size-9 items-center justify-center rounded-lg border transition-all hover:scale-[1.05] hover:bg-[var(--theme-card)]/70"
              style={{
                borderColor: layout.editMode
                  ? 'var(--theme-accent)'
                  : 'var(--theme-border)',
                background: layout.editMode
                  ? 'color-mix(in srgb, var(--theme-accent) 14%, transparent)'
                  : 'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 80%, transparent), transparent)',
                color: layout.editMode
                  ? 'var(--theme-accent)'
                  : 'var(--theme-muted)',
              }}
            >
              <HugeiconsIcon
                icon={layout.editMode ? CheckmarkCircle02Icon : Edit02Icon}
                size={15}
                strokeWidth={1.7}
              />
            </button>
            <button
              type="button"
              aria-label="Settings"
              title="Settings"
              onClick={() => navigate({ to: '/settings', search: {} })}
              className="inline-flex size-9 items-center justify-center rounded-lg border transition-all hover:scale-[1.05] hover:bg-[var(--theme-card)]/70 hover:text-[var(--theme-text)]"
              style={{
                borderColor: 'var(--theme-border)',
                color: 'var(--theme-muted)',
                background:
                  'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 80%, transparent), transparent)',
              }}
            >
              <HugeiconsIcon
                icon={Settings02Icon}
                size={15}
                strokeWidth={1.7}
              />
            </button>
          </div>
        </div>

        <SetupChecklistCard />

        {/* ── Social dashboard: left (you + agents) / centre (act now) /
           right (leaderboard + badges). 3 cols > 1180px, right column
           drops under at <= 1180px, everything stacks at <= 760px. ── */}
        <div className="grid grid-cols-1 gap-4 min-[761px]:grid-cols-[262px_minmax(0,1fr)] min-[1181px]:grid-cols-[262px_minmax(0,1fr)_292px]">
          <LeftColumn
            data={social}
            onOpenAgent={setAgentId}
            onOpenBadges={() => setBadgesOpen(true)}
          />
          <CenterColumn
            data={social}
            onChanged={() => {
              void socialQuery.refetch()
              void overviewQuery.refetch()
            }}
          />
          {/* RightColumn renders its own agent + badge dialogs, so its
            open callbacks are notifications only. */}
          <RightColumn
            data={social}
            onOpenAgent={() => undefined}
            onOpenBadges={() => undefined}
            className="min-[761px]:col-span-2 min-[1181px]:col-span-1"
          />
        </div>

        {/* ── Ops & analytics, pinned to the bottom of the content. ── */}
        <OpsSection
          className="mt-auto"
          overview={overview}
          period={period}
          onPeriodChange={setPeriod}
          installedCount={skillsInstalled}
          hourHistogram={hourHistogram}
        />
      </div>

      <StatusDock overview={overview} period={period} />

      <AgentDialog
        agent={openAgent}
        rank={openAgentRank > 0 ? openAgentRank : null}
        open={agentId !== null}
        onClose={() => setAgentId(null)}
      />
      <BadgeDialog
        badges={social.badges}
        open={badgesOpen}
        onClose={() => setBadgesOpen(false)}
      />
    </div>
  )
}
