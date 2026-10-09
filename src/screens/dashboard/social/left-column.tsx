import {
  AgentAvatar,
  LevelRing,
  Panel,
  ProgressBar,
  SectionHeading,
  agentColor,
} from './primitives'
import type { ReactNode } from 'react'
import type { DashboardSocial } from '@/types/dashboard-social'

type LeftColumnProps = {
  data: Pick<DashboardSocial, 'operator' | 'agents' | 'hotTopics' | 'badges'>
  onOpenAgent: (agentId: string) => void
  onOpenBadges: () => void
  className?: string
}

function cx(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** Every visible number goes through this: 4120 -> "4,120". */
const fmt = (n: number): string => n.toLocaleString('en-US')

const MUTED = 'var(--theme-muted)'

function MutedNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-[10px] text-[10px]" style={{ color: MUTED }}>
      {children}
    </p>
  )
}

/** Shared look of the three profile tiles (.tile in the mockup). */
const TILE_CLASS =
  'flex flex-col items-center gap-0.5 rounded-md border px-1 py-[7px]'

function TileLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[8px] tracking-[0.14em]" style={{ color: MUTED }}>
      {children}
    </span>
  )
}

function ProfileCard({
  operator,
  agents,
  badges,
  onOpenBadges,
}: {
  operator: DashboardSocial['operator']
  agents: DashboardSocial['agents']
  badges: DashboardSocial['badges']
  onOpenBadges: () => void
}) {
  if (!operator) {
    return (
      <Panel as="section">
        <SectionHeading>OPERATOR</SectionHeading>
        <MutedNote>Unavailable</MutedNote>
      </Panel>
    )
  }

  const span = operator.nextLevelXp - operator.levelStartXp
  const progress = span > 0 ? (operator.xp - operator.levelStartXp) / span : 0
  const earned = (badges ?? []).filter((b) => b.earnedAt !== null).length
  const hasBadges = badges !== null
  const profileLine = agents
    ? `Operator · ${fmt(agents.length)} agent profile${agents.length === 1 ? '' : 's'}`
    : 'Operator'

  return (
    <Panel
      as="section"
      className="flex flex-col items-center gap-2 text-center"
    >
      <LevelRing
        initial={operator.name.charAt(0).toUpperCase()}
        level={operator.level}
        progress={progress}
      />
      <h2 className="text-[15px] font-extrabold">{operator.name}</h2>
      <p className="text-[10px]" style={{ color: MUTED }}>
        {profileLine}
      </p>
      <div className="mt-1 flex w-full flex-col gap-1">
        <ProgressBar
          value={progress}
          label={`Experience toward level ${operator.level + 1}`}
        />
        <div className="flex text-[10px] tabular-nums" style={{ color: MUTED }}>
          <span>{fmt(operator.xp)} XP</span>
          <span className="grow" />
          <span>
            {fmt(operator.nextLevelXp - operator.xp)} to L{operator.level + 1}
          </span>
        </div>
      </div>
      <div className="mt-1 grid w-full grid-cols-[repeat(3,minmax(0,1fr))] gap-1.5">
        <div
          className={TILE_CLASS}
          style={{ borderColor: 'var(--theme-accent)' }}
        >
          <b
            className="text-[17px] tabular-nums"
            style={{ color: 'var(--theme-accent)' }}
          >
            {fmt(operator.xp)}
          </b>
          <TileLabel>XP</TileLabel>
        </div>
        <div
          className={TILE_CLASS}
          style={{ borderColor: 'var(--theme-warning)' }}
        >
          <b
            className="text-[17px] tabular-nums"
            style={{ color: 'var(--theme-warning)' }}
          >
            {fmt(operator.streakDays)}
          </b>
          <TileLabel>STREAK</TileLabel>
        </div>
        <button
          type="button"
          onClick={onOpenBadges}
          aria-label={
            hasBadges ? `View badges, ${fmt(earned)} earned` : 'View badges'
          }
          className={cx(TILE_CLASS, 'cursor-pointer')}
          style={{ borderColor: 'var(--dash-cat-workflow)' }}
        >
          <b
            className="text-[17px] tabular-nums"
            style={{ color: 'var(--dash-cat-workflow)' }}
          >
            {hasBadges ? fmt(earned) : '–'}
          </b>
          <TileLabel>BADGES</TileLabel>
        </button>
      </div>
    </Panel>
  )
}

function AgentsPanel({
  agents,
  onOpenAgent,
}: {
  agents: DashboardSocial['agents']
  onOpenAgent: (agentId: string) => void
}) {
  const max =
    agents && agents.length > 0 ? Math.max(...agents.map((a) => a.sessions)) : 0
  return (
    <Panel as="section" aria-labelledby="lc-agents-h">
      <SectionHeading
        id="lc-agents-h"
        action={
          <span
            className="text-[10px] font-normal tracking-normal"
            style={{ color: MUTED }}
          >
            sessions
          </span>
        }
      >
        MY AGENTS
      </SectionHeading>
      {agents === null ? (
        <MutedNote>Unavailable</MutedNote>
      ) : agents.length === 0 ? (
        <MutedNote>No agent profiles yet</MutedNote>
      ) : (
        <div className="mt-[10px] flex flex-col gap-2">
          {agents.map((agent, index) => {
            const color = agentColor(index)
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => onOpenAgent(agent.id)}
                aria-label={`${agent.id}, ${fmt(agent.sessions)} sessions, ${agent.working ? 'working now' : 'idle'}`}
                className="grid w-full cursor-pointer grid-cols-[22px_minmax(0,1fr)_44px] items-center gap-2 border-0 bg-transparent p-0 text-left"
              >
                <AgentAvatar
                  initials={agent.initials}
                  color={color}
                  working={agent.working}
                  label={agent.id}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[11px]">{agent.id}</span>
                  <ProgressBar
                    value={max > 0 ? agent.sessions / max : 0}
                    label={`${agent.id} sessions`}
                    color={color}
                    height={4}
                    className="mt-[3px]"
                  />
                </span>
                <span
                  className="block text-right text-[10px] tabular-nums"
                  style={{ color: MUTED }}
                >
                  {fmt(agent.sessions)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

function FlameIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      style={{ color: 'var(--theme-warning)' }}
      aria-hidden="true"
    >
      <path d="M8 14c-3 0-4-2-4-4 0-3 4-5 4-8 1 2 4 4 4 8 0 2-1 4-4 4z" />
    </svg>
  )
}

function HotTopicsPanel({
  hotTopics,
}: {
  hotTopics: DashboardSocial['hotTopics']
}) {
  return (
    <Panel as="section" aria-labelledby="lc-topics-h" className="flex-1">
      <SectionHeading id="lc-topics-h" icon={<FlameIcon />}>
        HOT THIS WEEK
      </SectionHeading>
      {hotTopics === null ? (
        <MutedNote>Unavailable</MutedNote>
      ) : (
        <>
          <div className="mt-[10px] flex flex-wrap gap-1.5">
            {hotTopics.slice(0, 5).map((topic, index) => (
              <a
                key={`${topic.href}-${topic.label}`}
                href={topic.href}
                className="rounded-full border px-[9px] py-[3px] text-[10px] no-underline"
                style={{
                  borderColor: 'var(--theme-border)',
                  color: 'var(--theme-text)',
                }}
              >
                <em className="mr-1 not-italic" style={{ color: MUTED }}>
                  #{index + 1}
                </em>{' '}
                {topic.label}
              </a>
            ))}
          </div>
          <p className="mt-2 text-[10px]" style={{ color: MUTED }}>
            From session titles and projects, last 7 days.
          </p>
        </>
      )}
    </Panel>
  )
}

/** Left column of the social dashboard: operator card, agent list, hot topics. */
export function LeftColumn({
  data,
  onOpenAgent,
  onOpenBadges,
  className,
}: LeftColumnProps) {
  return (
    <aside
      aria-label="You and your agents"
      className={cx('flex min-w-0 flex-col gap-[14px] self-stretch', className)}
    >
      <ProfileCard
        operator={data.operator}
        agents={data.agents}
        badges={data.badges}
        onOpenBadges={onOpenBadges}
      />
      <AgentsPanel agents={data.agents} onOpenAgent={onOpenAgent} />
      <HotTopicsPanel hotTopics={data.hotTopics} />
    </aside>
  )
}
