'use client'

/**
 * sidebar-header-v2.tsx — header row for the sessions panel.
 *
 * Shows: profile selector (or plain "SESSIONS · N"), date-filter / collapse icons.
 * Phase 3c: calendar icon wired to SidebarDatePopoverV2.
 */

import { useState } from 'react'
import { SidebarDatePopoverV2 } from './sidebar-date-popover-v2'
import { SidebarProfileDropdownV2 } from './sidebar-profile-dropdown-v2'
import type { ProfileTotalRow } from '@/screens/chat/sessions-feed'

interface SidebarHeaderV2Props {
  onCollapse?: () => void
  count?: number
  totals?: Array<ProfileTotalRow>
}

export function SidebarHeaderV2({
  onCollapse,
  count,
  totals,
}: SidebarHeaderV2Props) {
  const [dateOpen, setDateOpen] = useState(false)

  return (
    <div
      className="flex items-center justify-between shrink-0 px-3"
      data-testid="sessions-panel-header"
      style={{
        height: 44,
        borderBottom: '1px solid var(--theme-border)',
        background: 'var(--theme-sidebar)',
        position: 'relative',
      }}
    >
      {/* Left: profile selector (falls back to plain title + count) */}
      <SidebarProfileDropdownV2 totals={totals ?? []} count={count} />

      {/* Right: action icons */}
      <div className="flex items-center gap-0.5">
        {/* Refresh */}
        {/* Calendar / date filter */}
        <IconButton aria-label="Date filter" onClick={() => setDateOpen((v) => !v)} active={dateOpen}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="1" y="3" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M1 6h14" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </IconButton>
        {dateOpen && <SidebarDatePopoverV2 onClose={() => setDateOpen(false)} />}

        {/* Collapse / fold */}
        <IconButton aria-label="Collapse sessions panel" onClick={onCollapse}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </IconButton>
      </div>
    </div>
  )
}

// ── Small icon button helper ──────────────────────────────────────────────────

interface IconButtonProps {
  children: React.ReactNode
  'aria-label': string
  onClick?: () => void
  active?: boolean
}

function IconButton({ children, 'aria-label': ariaLabel, onClick, active }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex items-center justify-center rounded transition-colors"
      style={{
        width: 24,
        height: 24,
        color: active ? 'var(--m-green-400, var(--theme-accent))' : 'var(--theme-muted)',
        background: 'transparent',
        boxShadow: active ? '0 0 6px var(--m-green-500, var(--theme-accent))' : 'none',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}
