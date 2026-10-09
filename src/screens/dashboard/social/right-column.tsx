import { useId, useMemo, useState } from 'react'
import {
  AgentAvatar,
  Panel,
  ProgressBar,
  SectionHeading,
  agentColor,
} from './primitives'
import { AgentDialog } from './agent-dialog'
import { BadgeDialog, badgeProgress, badgeStatus } from './badge-dialog'
import type { CSSProperties, ReactNode } from 'react'
import type {
  DashboardAgent,
  DashboardBadge,
  DashboardSocial,
  OperatorStats,
} from '@/types/dashboard-social'

export interface RightColumnProps {
  data: Pick<DashboardSocial, 'agents' | 'operator' | 'badges'>
  /** Notified whenever a podium block or row opens an agent. */
  onOpenAgent: (id: string) => void
  /** Notified whenever the ALL button opens the badge grid. */
  onOpenBadges: () => void
  className?: string
}

type MetricId = 'tokens' | 'sessions' | 'tasks' | 'runs'

interface Metric {
  id: MetricId
  label: string
  caption: string
  value: (agent: DashboardAgent) => number
}

const METRICS: Array<Metric> = [
  {
    id: 'tokens',
    label: 'TOKENS',
    caption: 'Tokens this week · resets Monday',
    value: (agent) => agent.tokensWeek,
  },
  {
    id: 'sessions',
    label: 'SESSIONS',
    caption: 'Sessions, all time',
    value: (agent) => agent.sessions,
  },
  {
    id: 'tasks',
    label: 'TASKS',
    caption: 'Tasks finished this week',
    value: (agent) => agent.tasksWeek,
  },
  {
    id: 'runs',
    label: 'RUNS',
    caption: 'Workflow runs this week',
    value: (agent) => agent.runsWeek,
  },
]

/** Podium geometry: rank 2 left, rank 1 tall in the middle, rank 3 right. */
const PODIUM_ORDER = [2, 1, 3]
const PODIUM_HEIGHT: Record<number, number> = { 1: 126, 2: 96, 3: 76 }
const PODIUM_RING: Record<number, string> = {
  1: 'var(--dash-podium-1)',
  2: 'var(--dash-podium-2)',
  3: 'var(--dash-podium-3)',
}

const WEEKDAYS = [
  { letter: 'M', name: 'Monday' },
  { letter: 'T', name: 'Tuesday' },
  { letter: 'W', name: 'Wednesday' },
  { letter: 'T', name: 'Thursday' },
  { letter: 'F', name: 'Friday' },
  { letter: 'S', name: 'Saturday' },
  { letter: 'S', name: 'Sunday' },
]

/** Mockup formatting: 4.2M / 86k / 993. */
function compact(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}

/** Descending by the active metric; ties fall back to id so the order is stable. */
function rankAgents(agents: Array<DashboardAgent>, metric: Metric) {
  return [...agents].sort(
    (a, b) =>
      metric.value(b) - metric.value(a) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

function Unavailable({ what }: { what: string }) {
  return (
    <p className="mt-2 text-[10.5px]" style={{ color: 'var(--theme-muted)' }}>
      <span style={{ color: 'var(--theme-text)' }}>Unavailable</span> — {what}{' '}
      could not be loaded.
    </p>
  )
}

/** Small outlined action, as used by the badges heading. */
function GhostButton({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded border bg-transparent px-2 py-1 text-[9px] tracking-[0.1em]"
      style={{
        borderColor: 'var(--theme-border)',
        color: 'var(--theme-text)',
      }}
    >
      {children}
    </button>
  )
}

function MetricToggle({
  active,
  onPick,
}: {
  active: Metric
  onPick: (id: MetricId) => void
}) {
  return (
    <div
      role="group"
      aria-label="Rank by"
      className="mt-2.5 flex flex-wrap gap-1"
    >
      {METRICS.map((metric) => {
        const pressed = metric.id === active.id
        return (
          <button
            key={metric.id}
            type="button"
            aria-pressed={pressed}
            onClick={() => onPick(metric.id)}
            className="cursor-pointer rounded border bg-transparent px-[7px] py-[3px] text-[9px] tracking-[0.08em]"
            style={
              pressed
                ? {
                    borderColor: 'var(--theme-accent)',
                    color: 'var(--theme-accent)',
                    background: 'var(--theme-accent-subtle)',
                  }
                : {
                    borderColor: 'var(--theme-border)',
                    color: 'var(--theme-muted)',
                  }
            }
          >
            {metric.label}
          </button>
        )
      })}
    </div>
  )
}

interface Entry {
  agent: DashboardAgent
  rank: number
  value: string
  color: string
}

function LeaderboardPanel({
  agents,
  ranked,
  metric,
  onOpenAgent,
  onPickMetric,
  headingId,
}: {
  agents: Array<DashboardAgent> | null
  ranked: Array<DashboardAgent>
  metric: Metric
  onOpenAgent: (id: string) => void
  onPickMetric: (id: MetricId) => void
  headingId: string
}) {
  // Same index => same colour in every column, matching the shared primitives.
  const colorOf = new Map<string, string>()
  agents?.forEach((agent, index) => colorOf.set(agent.id, agentColor(index)))
  const colorFor = (agent: DashboardAgent) =>
    colorOf.get(agent.id) ?? agentColor(0)

  const entries: Array<Entry> = ranked.map((agent, index) => ({
    agent,
    rank: index + 1,
    value: compact(metric.value(agent)),
    color: colorFor(agent),
  }))
  const podium = PODIUM_ORDER.filter((rank) => rank <= entries.length).map(
    (rank) => entries[rank - 1],
  )
  const rows = entries.slice(3)

  return (
    <Panel as="section" aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        icon={
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
            style={{ color: PODIUM_RING[1] }}
          >
            <path d="M5 2h6v4a3 3 0 0 1-6 0zM5 3H3v1a2 2 0 0 0 2 2M11 3h2v1a2 2 0 0 1-2 2M8 9v3M5.5 14h5" />
          </svg>
        }
      >
        AGENT LEADERBOARD
      </SectionHeading>
      <MetricToggle active={metric} onPick={onPickMetric} />

      {agents ? (
        podium.length > 0 ? (
          <div className="mt-3.5 grid grid-cols-3 items-end gap-1.5">
            {podium.map((entry) => (
              <button
                key={entry.agent.id}
                type="button"
                onClick={() => onOpenAgent(entry.agent.id)}
                aria-label={`${entry.agent.id}, rank ${entry.rank}, ${entry.value}`}
                className="flex cursor-pointer flex-col items-center gap-1.5 border-0 bg-transparent p-0"
                style={
                  {
                    color: 'var(--theme-text)',
                    '--r': PODIUM_RING[entry.rank],
                  } as CSSProperties
                }
              >
                {entry.rank === 1 ? (
                  <svg
                    width="22"
                    height="14"
                    viewBox="0 0 22 14"
                    fill="currentColor"
                    aria-hidden="true"
                    style={{ color: PODIUM_RING[1] }}
                  >
                    <path d="M1 13l2-10 5 5 3-7 3 7 5-5 2 10z" />
                  </svg>
                ) : null}
                <AgentAvatar
                  initials={entry.agent.initials}
                  color={entry.color}
                  size={42}
                  working={entry.agent.working}
                  className="shadow-[0_0_0_2px_var(--r)]"
                />
                <span
                  className="flex w-full flex-col items-center justify-between rounded-t-[5px] border border-b-0 px-0.5 pb-[6px] pt-[7px]"
                  style={{
                    height: PODIUM_HEIGHT[entry.rank],
                    borderColor: PODIUM_RING[entry.rank],
                    background: 'var(--theme-card2)',
                  }}
                >
                  <b className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-bold">
                    {entry.agent.id}
                  </b>
                  <span
                    className="text-[9.5px]"
                    style={{ color: 'var(--theme-muted)' }}
                  >
                    {entry.value}
                  </span>
                  <em
                    className="text-[22px] font-extrabold not-italic"
                    style={{ color: PODIUM_RING[entry.rank] }}
                  >
                    {entry.rank}
                  </em>
                </span>
              </button>
            ))}
          </div>
        ) : null
      ) : (
        <Unavailable what="The leaderboard" />
      )}

      {agents && rows.length > 0 ? (
        <div
          className="mt-3 flex flex-col gap-[7px] border-t pt-2.5"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          {rows.map((entry) => (
            <button
              key={entry.agent.id}
              type="button"
              onClick={() => onOpenAgent(entry.agent.id)}
              aria-label={`${entry.agent.id}, rank ${entry.rank}, ${entry.value}`}
              className="grid w-full cursor-pointer grid-cols-[16px_22px_minmax(0,1fr)_auto] items-center gap-2 border-0 bg-transparent p-0 text-left text-[10.5px]"
              style={{ color: 'var(--theme-text)' }}
            >
              <span
                className="text-[10px]"
                style={{ color: 'var(--theme-muted)' }}
              >
                {entry.rank}
              </span>
              <AgentAvatar
                initials={entry.agent.initials}
                color={entry.color}
                size={22}
                working={entry.agent.working}
              />
              <span className="truncate">{entry.agent.id}</span>
              <span
                className="text-[10px]"
                style={{ color: 'var(--theme-muted)' }}
              >
                {entry.value}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <p className="mt-2 text-[10px]" style={{ color: 'var(--theme-muted)' }}>
        {metric.caption}
      </p>
    </Panel>
  )
}

/** Seven cells M–S; today (the last cell) stays dashed until it is active. */
function WeekStrip({ activeDays }: { activeDays: Array<boolean> }) {
  const days = WEEKDAYS.map((day, index) => ({
    ...day,
    active: activeDays[index] === true,
    today: index === WEEKDAYS.length - 1,
  }))
  const activeCount = days.filter((day) => day.active).length
  const label = `This week: ${activeCount} of ${WEEKDAYS.length} days active${
    days[days.length - 1].active ? '' : ', today not yet'
  }`

  return (
    <div className="mt-2.5 grid grid-cols-7 gap-[5px]" aria-label={label}>
      {days.map((day) => {
        const state = day.active ? 'active' : day.today ? 'today' : 'empty'
        return (
          <div
            key={day.name}
            className="flex flex-col items-center gap-1 text-[8.5px]"
            style={{ color: 'var(--theme-muted)' }}
          >
            <i
              aria-hidden="true"
              data-state={state}
              className="h-[22px] w-full rounded border"
              style={
                day.active
                  ? {
                      background: 'var(--theme-accent)',
                      borderColor: 'var(--theme-accent)',
                    }
                  : day.today
                    ? {
                        background: 'transparent',
                        borderColor: 'var(--theme-accent)',
                        borderStyle: 'dashed',
                      }
                    : {
                        background: 'var(--theme-accent-subtle)',
                        borderColor: 'var(--theme-border)',
                      }
              }
            />
            <span aria-hidden="true">{day.letter}</span>
            <span className="sr-only">
              {day.name} {day.active ? 'active' : 'not active'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function StreakPanel({
  operator,
  headingId,
}: {
  operator: OperatorStats | null
  headingId: string
}) {
  return (
    <Panel as="section" aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        icon={
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
            style={{ color: 'var(--theme-warning)' }}
          >
            <path d="M8 14c-3 0-4-2-4-4 0-3 4-5 4-8 1 2 4 4 4 8 0 2-1 4-4 4z" />
          </svg>
        }
      >
        DAILY STREAK
      </SectionHeading>

      {operator ? (
        <>
          <div className="mt-2 flex items-center gap-2.5">
            <b
              className="text-[30px] font-extrabold"
              style={{ color: 'var(--theme-warning)' }}
            >
              {operator.streakDays}
            </b>
            <div>
              <div>days in a row</div>
              <div
                className="text-[10px]"
                style={{ color: 'var(--theme-muted)' }}
              >
                best {operator.bestStreak} · a chat or run today keeps it
              </div>
            </div>
          </div>
          <WeekStrip activeDays={operator.activeDays} />
        </>
      ) : (
        <Unavailable what="Your streak" />
      )}
    </Panel>
  )
}

function BadgesPanel({
  badges,
  headingId,
  onOpenBadges,
}: {
  badges: Array<DashboardBadge> | null
  headingId: string
  onOpenBadges: () => void
}) {
  const nextBadges = badges
    ? [...badges]
        .filter((badge) => badgeStatus(badge) !== 'earned')
        .sort((a, b) => badgeProgress(b) - badgeProgress(a))
        .slice(0, 3)
    : []

  return (
    <Panel as="section" aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        action={
          <span className="flex items-center gap-2">
            {badges ? (
              <span
                className="text-[10px] font-normal tracking-normal"
                style={{ color: 'var(--theme-muted)' }}
              >
                {
                  badges.filter((badge) => badgeStatus(badge) === 'earned')
                    .length
                }{' '}
                of {badges.length}
              </span>
            ) : null}
            <GhostButton onClick={onOpenBadges}>ALL</GhostButton>
          </span>
        }
      >
        BADGES
      </SectionHeading>

      {badges ? (
        nextBadges.length > 0 ? (
          <div className="mt-2.5 flex flex-col gap-[9px]">
            {nextBadges.map((badge, index) => (
              <div key={badge.id}>
                <div className="flex items-center">
                  <span>{badge.name}</span>
                  <span className="grow" />
                  <span
                    className="text-[10px]"
                    style={{ color: 'var(--theme-muted)' }}
                  >
                    {`${compact(badge.have)} / ${compact(badge.need)}`}
                  </span>
                </div>
                <div
                  className="text-[10px]"
                  style={{ color: 'var(--theme-muted)' }}
                >
                  {badge.how}
                </div>
                <ProgressBar
                  className="mt-1"
                  value={badgeProgress(badge)}
                  label={`${badge.name} progress`}
                  height={4}
                  color={agentColor(index)}
                />
              </div>
            ))}
          </div>
        ) : (
          <p
            className="mt-2 text-[10.5px]"
            style={{ color: 'var(--theme-muted)' }}
          >
            Every badge is earned — nothing in progress.
          </p>
        )
      ) : (
        <Unavailable what="Badges" />
      )}
    </Panel>
  )
}

/**
 * Right column of the social dashboard: agent leaderboard, daily streak and
 * badge progress, plus the badge and agent dialogs that open from here.
 */
export function RightColumn({
  data,
  onOpenAgent,
  onOpenBadges,
  className,
}: RightColumnProps) {
  const [metricId, setMetricId] = useState<MetricId>('tokens')
  const [openAgentId, setOpenAgentId] = useState<string | null>(null)
  const [badgesOpen, setBadgesOpen] = useState(false)
  const leaderboardId = useId()
  const streakId = useId()
  const badgesId = useId()

  const agents = data.agents
  const operator = data.operator
  const badges = data.badges
  const metric = METRICS.find((entry) => entry.id === metricId) ?? METRICS[0]
  const ranked = useMemo(
    () => (agents ? rankAgents(agents, metric) : []),
    [agents, metric],
  )

  const openAgent = (id: string) => {
    setOpenAgentId(id)
    onOpenAgent(id)
  }
  const openBadges = () => {
    setBadgesOpen(true)
    onOpenBadges()
  }

  const openAgentData =
    openAgentId && agents
      ? (agents.find((agent) => agent.id === openAgentId) ?? null)
      : null
  const rank = openAgentData
    ? ranked.findIndex((agent) => agent.id === openAgentData.id) + 1
    : 0

  return (
    <aside
      aria-label="Leaderboard, streak and badges"
      className={`flex min-w-0 flex-col gap-[14px]${className ? ` ${className}` : ''}`}
    >
      <LeaderboardPanel
        agents={agents}
        ranked={ranked}
        metric={metric}
        onOpenAgent={openAgent}
        onPickMetric={setMetricId}
        headingId={leaderboardId}
      />
      <StreakPanel operator={operator} headingId={streakId} />
      <BadgesPanel
        badges={badges}
        headingId={badgesId}
        onOpenBadges={openBadges}
      />

      <AgentDialog
        agent={openAgentData}
        rank={rank > 0 ? rank : null}
        open={openAgentId !== null}
        onClose={() => setOpenAgentId(null)}
      />
      <BadgeDialog
        badges={badges}
        open={badgesOpen}
        onClose={() => setBadgesOpen(false)}
      />
    </aside>
  )
}
