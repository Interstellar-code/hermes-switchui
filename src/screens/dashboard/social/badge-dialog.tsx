import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ProgressBar, agentColor } from './primitives'
import type { CSSProperties } from 'react'
import type { DashboardBadge } from '@/types/dashboard-social'
import { useFocusTrap } from '@/components/ui/use-focus-trap'

export type BadgeState = 'earned' | 'in-progress' | 'locked'

/** Mockup formatting: 4.2M / 86k / 993. */
function compact(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}

/** 0–1 share of the way to the goal; a non-positive goal is either met or empty. */
export function badgeProgress(badge: DashboardBadge): number {
  const have = Number.isFinite(badge.have) ? badge.have : 0
  const need = Number.isFinite(badge.need) ? badge.need : 0
  if (need <= 0) return have > 0 ? 1 : 0
  return Math.min(1, Math.max(0, have / need))
}

/**
 * earned iff have >= need; otherwise in-progress at 30% or more, else locked.
 * Exactly one state per badge — never earned and in-progress at once.
 */
export function badgeStatus(badge: DashboardBadge): BadgeState {
  if (!Number.isFinite(badge.have) || !Number.isFinite(badge.need)) {
    return 'locked'
  }
  if (badge.have >= badge.need) return 'earned'
  return badgeProgress(badge) >= 0.3 ? 'in-progress' : 'locked'
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="inline-flex h-[26px] w-[28px] cursor-pointer items-center justify-center rounded border bg-transparent p-0"
      style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <path d="M3 3l10 10M13 3L3 13" />
      </svg>
    </button>
  )
}

function Medal({ color }: { color: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
      style={{ color }}
    >
      <path d="M5 2h6v4a3 3 0 0 1-6 0zM8 9v3M5.5 14h5" />
    </svg>
  )
}

function BadgeCell({ badge, color }: { badge: DashboardBadge; color: string }) {
  const status = badgeStatus(badge)
  const locked = status === 'locked'
  const ringColor = locked ? 'var(--theme-muted)' : color
  const ring: CSSProperties = {
    borderColor: ringColor,
    borderStyle: status === 'earned' ? 'solid' : 'dashed',
    color: ringColor,
    background: 'var(--theme-card2)',
  }

  return (
    <div
      role="group"
      aria-label={badge.name}
      className="flex flex-col items-center gap-[5px] text-center text-[9.5px]"
      style={{ color: locked ? 'var(--theme-muted)' : 'var(--theme-text)' }}
    >
      <span
        className="flex h-[46px] w-[46px] items-center justify-center rounded-full border-2"
        style={ring}
      >
        <Medal color="currentColor" />
      </span>
      <b className="font-bold">{badge.name}</b>
      <span className="text-[10px]" style={{ color: 'var(--theme-muted)' }}>
        {badge.how}
      </span>
      {status === 'in-progress' ? (
        <>
          <ProgressBar
            className="w-[70%]"
            value={badgeProgress(badge)}
            label={`${badge.name} progress`}
            height={4}
            color={color}
          />
          <span className="text-[10px]" style={{ color: 'var(--theme-muted)' }}>
            {`${compact(badge.have)} / ${compact(badge.need)}`}
          </span>
        </>
      ) : null}
      {status === 'earned' ? (
        <span className="text-[10px]" style={{ color: 'var(--theme-accent)' }}>
          earned
        </span>
      ) : null}
    </div>
  )
}

/** The badge grid: every badge, one state each (earned / in progress / locked). */
export function BadgeDialog({
  badges,
  open,
  onClose,
}: {
  /** null slice renders an unavailable empty state. */
  badges: Array<DashboardBadge> | null
  open: boolean
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useFocusTrap(open, dialogRef, onClose)

  if (!open) return null

  const list = badges ?? []
  const earned = list.filter((badge) => badgeStatus(badge) === 'earned').length

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[110px]"
      style={{ background: 'var(--theme-glass)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="w-[min(580px,100%)] overflow-hidden rounded-[10px] border"
        style={{
          borderColor: 'var(--theme-accent-border)',
          background: 'var(--theme-panel)',
          boxShadow: 'var(--theme-shadow-3)',
        }}
      >
        <div
          className="flex items-center gap-2.5 border-b p-[14px] px-4"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          <h2 id={titleId} className="text-[13px] font-extrabold">
            Badges · {earned} of {list.length}
          </h2>
          <span className="grow" />
          <CloseButton onClose={onClose} />
        </div>
        <div className="flex flex-col gap-3 p-[14px] px-4">
          {list.length === 0 ? (
            <p
              className="text-[10.5px]"
              style={{ color: 'var(--theme-muted)' }}
            >
              <span style={{ color: 'var(--theme-text)' }}>Unavailable</span> —
              no badge data could be loaded.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-3 md:grid-cols-4">
              {list.map((badge, index) => (
                <li key={badge.id} className="list-none">
                  <BadgeCell badge={badge} color={agentColor(index)} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div
          className="border-t px-4 py-3 text-[10px] leading-relaxed"
          style={{
            borderColor: 'var(--theme-border)',
            background: 'var(--theme-sidebar)',
            color: 'var(--theme-muted)',
          }}
        >
          Badges come from the achievements plugin and your agents' work: runs,
          streaks, tokens, approvals.
        </div>
      </div>
    </div>,
    document.body,
  )
}
