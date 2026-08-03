'use client'

/**
 * sidebar-profile-dropdown-v2.tsx — profile selector for the sessions panel.
 *
 * Owns the whole left slot of `sidebar-header-v2`. Replaces the old
 * `sidebar-profile-chips-v2` row: instead of listing every profile inline it
 * shows the selected one and offers the rest in a dropdown, and selecting one
 * scopes the sessions list to it (see `useScopedChatSessionsFeed`).
 *
 * Profiles whose `state.db` schema has drifted fail server-side and come back
 * with an `error` instead of a trustworthy count. Those NEVER render as "0" —
 * a silent zero on a profile with real sessions is a lie that costs the user
 * real data. They render "!" and carry the upstream reason in title +
 * aria-label, exactly as the chips did.
 *
 * With nothing to choose between (one healthy profile, no errors, nothing
 * selected) the affordance is hidden entirely and the plain `SESSIONS · N`
 * label renders — that is what an unscoped, single-gateway install already
 * looks like (§2 DoD: byte-identical unscoped behaviour).
 */

import { useEffect, useRef, useState } from 'react'
import type { ProfileTotalRow } from '@/screens/chat/sessions-feed'
import { ACTIVE_PROFILE } from '@/screens/chat/sessions-feed'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'

const ERROR_COLOR = 'var(--m-red, #ff4444)'
const ACCENT = 'var(--m-green-400, var(--theme-accent))'
const ACCENT_BG =
  'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 18%, transparent)'

interface SidebarProfileDropdownV2Props {
  totals: Array<ProfileTotalRow>
  count?: number
}

export function SidebarProfileDropdownV2({
  totals,
  count,
}: SidebarProfileDropdownV2Props) {
  const profile = useSessionsFilterStore((s) => s.profile)
  const setProfile = useSessionsFilterStore((s) => s.setProfile)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const isActive = profile === ACTIVE_PROFILE

  // Nothing worth choosing between. Kept conditional on `isActive` too: a
  // persisted foreign profile with an empty/short totals list would otherwise
  // hide the only way back to the unscoped view.
  if (isActive && totals.length <= 1 && !totals.some((t) => t.error)) {
    return (
      <div className="flex items-center gap-1 min-w-0">
        <SessionsLabel count={count} />
      </div>
    )
  }

  const selected = totals.find((t) => t.profile === profile)

  return (
    <div ref={rootRef} className="flex items-center gap-1 min-w-0">
      <button
        type="button"
        data-testid="sidebar-profile-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          isActive
            ? 'Sessions profile: active profile'
            : selected?.error
              ? `${profile} profile unavailable: ${selected.error}`
              : `Sessions profile: ${profile}`
        }
        title={selected?.error ? `${profile}: ${selected.error}` : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 min-w-0 rounded px-1"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'inherit',
        }}
      >
        {isActive ? (
          <SessionsLabel count={count} />
        ) : (
          <>
            <span
              className="m-label m-label-accent select-none truncate"
              style={selected?.error ? { color: ERROR_COLOR } : undefined}
            >
              {profile}
            </span>
            <span
              className="m-mono select-none"
              style={{
                color: selected?.error ? ERROR_COLOR : 'var(--theme-muted)',
              }}
            >
              · {selected?.error ? '!' : (selected?.count ?? count ?? 0)}
            </span>
          </>
        )}
        <span
          aria-hidden
          className="m-mono select-none"
          style={{ color: 'var(--theme-muted)', fontSize: 8 }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Select profile"
          data-testid="sidebar-profile-menu"
          style={{
            position: 'absolute',
            top: 40,
            left: 8,
            zIndex: 100,
            minWidth: 200,
            background: 'var(--theme-card, #0d1117)',
            border: '1px solid var(--theme-border)',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <ProfileOption
            label="active"
            hint="gateway profile"
            selected={isActive}
            onSelect={() => {
              setProfile(ACTIVE_PROFILE)
              setOpen(false)
            }}
          />
          {totals.map((row) => (
            <ProfileOption
              key={row.profile}
              label={row.profile}
              row={row}
              selected={row.profile === profile}
              onSelect={() => {
                setProfile(row.profile)
                setOpen(false)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Today's plain header label, unchanged. */
function SessionsLabel({ count }: { count?: number }) {
  return (
    <>
      <span className="m-label m-label-accent select-none">SESSIONS</span>
      {count != null && (
        <span
          className="m-mono select-none"
          style={{ color: 'var(--theme-muted)' }}
        >
          · {count}
        </span>
      )}
    </>
  )
}

interface ProfileOptionProps {
  label: string
  hint?: string
  row?: ProfileTotalRow
  selected: boolean
  onSelect: () => void
}

function ProfileOption({
  label,
  hint,
  row,
  selected,
  onSelect,
}: ProfileOptionProps) {
  const degraded = row?.error != null
  const color = degraded ? ERROR_COLOR : 'var(--theme-text)'

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      data-testid={`profile-option-${label}`}
      data-degraded={degraded || undefined}
      title={degraded ? `${label}: ${row.error}` : undefined}
      aria-label={
        degraded
          ? `${label} profile unavailable: ${row.error}`
          : row
            ? `${label} profile, ${row.count} sessions`
            : `${label} profile`
      }
      onClick={onSelect}
      className="m-mono flex items-center justify-between gap-2 rounded px-2 py-1"
      style={{
        fontSize: 10,
        textAlign: 'left',
        border: `1px solid ${selected ? ACCENT : 'transparent'}`,
        background: selected ? ACCENT_BG : 'transparent',
        color,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <span className="truncate">
        {label}
        {hint && (
          <span style={{ color: 'var(--theme-muted)', marginLeft: 4 }}>
            {hint}
          </span>
        )}
      </span>
      {row && (
        <span
          className="rounded-full px-1"
          style={{
            background: degraded
              ? `color-mix(in srgb, ${ERROR_COLOR} 30%, transparent)`
              : 'var(--theme-border)',
            color: degraded ? ERROR_COLOR : 'var(--theme-muted)',
            fontSize: 9,
            lineHeight: '14px',
            minWidth: 14,
            textAlign: 'center',
          }}
        >
          {degraded ? '!' : row.count}
        </span>
      )}
    </button>
  )
}
