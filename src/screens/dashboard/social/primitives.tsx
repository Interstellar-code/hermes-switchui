import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import './social.css'

function cx(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(' ')
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

const AGENT_COLORS = [
  'var(--dash-cat-chat)',
  'var(--dash-cat-cron)',
  'var(--dash-cat-workflow)',
  'var(--dash-cat-memory)',
  'var(--dash-cat-task)',
  'var(--dash-cat-improve)',
]

/** Same colour for the same agent index in every column. */
export function agentColor(index: number): string {
  if (!Number.isFinite(index) || index < 0) return AGENT_COLORS[0]
  return AGENT_COLORS[Math.trunc(index) % AGENT_COLORS.length]
}

type PanelProps = HTMLAttributes<HTMLElement> & {
  as?: 'section' | 'div' | 'aside'
  tone?: 'default' | 'warning'
}

export function Panel({
  as: Tag = 'div',
  tone = 'default',
  className,
  style,
  children,
  ...rest
}: PanelProps) {
  const warning = tone === 'warning'
  return (
    <Tag
      {...rest}
      className={cx('rounded-lg border p-[14px]', className)}
      style={{
        borderColor: warning ? 'var(--dash-cat-needs)' : 'var(--theme-border)',
        background: 'var(--theme-panel)',
        ...style,
      }}
    >
      {children}
    </Tag>
  )
}

type SectionHeadingProps = {
  id?: string
  icon?: ReactNode
  count?: number
  action?: ReactNode
  className?: string
  children: ReactNode
}

export function SectionHeading({
  id,
  icon,
  count,
  action,
  className,
  children,
}: SectionHeadingProps) {
  return (
    <h2
      id={id}
      className={cx(
        'flex items-center gap-2 text-[10px] font-extrabold tracking-[0.16em]',
        className,
      )}
      style={{ color: 'var(--theme-accent)' }}
    >
      {icon}
      {children}
      {count !== undefined ? (
        <span
          className="rounded-full px-1.5 text-[9px] tracking-normal"
          style={{
            background: 'var(--theme-accent)',
            color: 'var(--theme-bg)',
          }}
        >
          {count}
        </span>
      ) : null}
      {action ? <span className="ml-auto">{action}</span> : null}
    </h2>
  )
}

type LevelRingProps = {
  initial: string
  level: number
  /** 0–1 share of the way to the next level. */
  progress: number
  className?: string
}

export function LevelRing({
  initial,
  level,
  progress,
  className,
}: LevelRingProps) {
  const deg = Math.round(clamp01(progress) * 360)
  return (
    <div
      className={cx('flex flex-col items-center', className)}
      role="img"
      aria-label={`Level ${level}, ${Math.round(clamp01(progress) * 100)}% to next level`}
    >
      <div
        className="flex h-[84px] w-[84px] items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(var(--theme-accent) ${deg}deg, var(--theme-accent-subtle) 0)`,
        }}
      >
        <span
          className="flex h-[74px] w-[74px] items-center justify-center rounded-full text-[28px] font-extrabold"
          style={{
            background: 'var(--theme-card2)',
            color: 'var(--theme-text)',
          }}
        >
          {initial}
        </span>
      </div>
      <span
        className="-mt-4 rounded-full px-[9px] py-0.5 text-[9px] font-extrabold tracking-[0.14em]"
        style={{ background: 'var(--theme-accent)', color: 'var(--theme-bg)' }}
      >
        LEVEL {level}
      </span>
    </div>
  )
}

type ProgressBarProps = {
  /** 0–1; values outside are clamped. */
  value: number
  label: string
  color?: string
  height?: number
  className?: string
}

export function ProgressBar({
  value,
  label,
  color = 'var(--theme-accent)',
  height = 6,
  className,
}: ProgressBarProps) {
  const pct = Math.round(clamp01(value) * 100)
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cx('block overflow-hidden rounded-[3px]', className)}
      style={{ height, background: 'var(--theme-accent-subtle)' }}
    >
      <i
        className="block h-full"
        style={{ width: `${pct}%`, background: color }}
      />
    </span>
  )
}

type AgentAvatarProps = {
  initials: string
  color: string
  size?: number
  working?: boolean
  /** Accessible name; when set the avatar is exposed as an image. */
  label?: string
  className?: string
}

export function AgentAvatar({
  initials,
  color,
  size = 22,
  working,
  label,
  className,
}: AgentAvatarProps) {
  const style: CSSProperties = {
    width: size,
    height: size,
    background: color,
    color: 'var(--theme-bg)',
    fontSize: Math.max(8, Math.round(size * 0.4)),
  }
  return (
    <span
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center rounded-full font-extrabold',
        className,
      )}
      style={style}
      {...(label ? { role: 'img', 'aria-label': label } : {})}
    >
      <span aria-hidden="true">{initials}</span>
      {working ? (
        <>
          <span
            aria-hidden="true"
            className="absolute -bottom-px -right-px h-2 w-2 rounded-full border"
            style={{
              background: 'var(--theme-success)',
              borderColor: 'var(--theme-bg)',
            }}
          />
          <span className="sr-only">working now</span>
        </>
      ) : null}
    </span>
  )
}

type CountRingProps = {
  href: string
  label: string
  /** CSS colour value, e.g. `var(--dash-cat-cron)`. */
  color: string
  icon: ReactNode
  count?: number
  /** Show the gateway-ok dot instead of a count. */
  ok?: boolean
  className?: string
}

export function CountRing({
  href,
  label,
  color,
  icon,
  count,
  ok,
  className,
}: CountRingProps) {
  return (
    <a
      href={href}
      className={cx(
        'flex flex-col items-center gap-1.5 no-underline',
        className,
      )}
      style={{ color: 'var(--theme-text)' }}
    >
      <span
        className="relative flex h-[54px] w-[54px] items-center justify-center rounded-full border-2"
        style={{
          borderColor: color,
          color,
          background: 'var(--theme-panel)',
        }}
      >
        {icon}
        {ok ? (
          <span
            data-testid="count-ring-ok"
            className="absolute bottom-0 -right-0.5 h-3 w-3 rounded-full border-2"
            style={{
              background: 'var(--theme-success)',
              borderColor: 'var(--theme-bg)',
            }}
          >
            <span className="sr-only">ok</span>
          </span>
        ) : count ? (
          <span
            className="absolute -bottom-0.5 -right-1.5 rounded-full border-2 px-[5px] text-[9px] font-extrabold"
            style={{
              background: color,
              color: 'var(--theme-bg)',
              borderColor: 'var(--theme-bg)',
            }}
          >
            {count}
          </span>
        ) : null}
      </span>
      <span className="text-center text-[9.5px]">{label}</span>
    </a>
  )
}

type ChipProps = {
  color: string
  className?: string
  children: ReactNode
}

export function Chip({ color, className, children }: ChipProps) {
  return (
    <span
      className={cx(
        'whitespace-nowrap rounded-[3px] border px-[5px] py-px text-[8.5px] tracking-[0.08em]',
        className,
      )}
      style={{ color, borderColor: color }}
    >
      {children}
    </span>
  )
}
