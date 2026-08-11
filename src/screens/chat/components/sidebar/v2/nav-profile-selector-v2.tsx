'use client'

/**
 * nav-profile-selector-v2.tsx — the app-wide "which profile am I working in"
 * control, mounted in the primary nav above `+ New Session`.
 *
 * ── Why it sits ABOVE `+ New Session` rather than replacing it ───────────────
 *
 * They are different verbs. This one sets *scope* — a mode the whole tab works
 * in until it is changed. `+ New Session` *acts*, and it is the highest
 * frequency action in the nav. Folding a one-click action into a menu that
 * exists to hold a rarely-changed mode costs a click on every chat to save a
 * row on a surface that has thirty of them.
 *
 * ── What it writes ──────────────────────────────────────────────────────────
 *
 * The **device layer** of the one resolver in `lib/session-scope.ts`
 * (`url ?? device ?? null`), through `sessions-filter-store`'s `setProfile`.
 * That store is the device layer's only writer — it publishes to
 * `setDeviceSessionProfile` and persists, so calling the setter directly from
 * here would produce an unpersisted value that the store's next publish
 * silently overwrites. It reads the resolver back, exactly like
 * `sidebar-profile-dropdown-v2`, so this control, the sessions list and the
 * composer's send target cannot disagree.
 *
 * It does NOT call `/api/profiles/activate`. That endpoint rewrites
 * `~/.hermes/active_profile` and needs a gateway restart to take effect — a
 * machine-wide, out-of-band change. Scoping a tab is neither.
 *
 * ── What outranks it ────────────────────────────────────────────────────────
 *
 * `?profile=` on the tab's URL. A session id is NOT unique across profiles, so
 * a chat that loses its profile mid-thread keeps streaming, returns 200, and
 * writes the rest of itself into a different profile's `state.db`. The URL layer
 * outranking the device layer is what makes that unexpressible, and this control
 * must not pretend otherwise: while pinned it never reaches `setProfile`.
 *
 * Rather than going inert, the pinned menu changes verb — picking a profile
 * OPENS A NEW SESSION in it (`onNewSessionInProfile`) instead of retargeting the
 * open one. Without that injection the pinned control is simply disabled,
 * mirroring the sidebar dropdown. The navigation is injected rather than taken
 * from `useNavigate()` so this control renders — and tests — without router
 * context.
 *
 * ── What it reads, and when ─────────────────────────────────────────────────
 *
 * The trigger needs only the resolved profile, which is free. Everything with a
 * network cost — the profile roster, cross-profile totals, and per-profile
 * reachability — lives in `NavProfileMenu`, which mounts only while the menu is
 * open. This component renders on EVERY route, so a closed menu must add no
 * background polling to the app.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ProfileTotalRow } from '@/screens/chat/sessions-feed'
import { useProfileScope } from '@/hooks/use-resolved-profile'
import { useAgentProfiles } from '@/hooks/use-agent-profiles'
import { useProfileScopeStatus } from '@/hooks/use-profile-scope-status'
import { useProfileSessionTotals } from '@/screens/chat/sessions-feed'
import {
  UNSCOPED_PROFILE,
  useSessionsFilterStore,
} from '@/stores/sessions-filter-store'

const ACCENT = 'var(--m-green-400, var(--theme-accent))'
const ACCENT_BG =
  'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 18%, transparent)'
const ERROR_COLOR = 'var(--m-red, #ff4444)'
const MENU_WIDTH = 224

/** Same path as `ICONS.profiles` in `primary-nav-v2` — the nav's glyph for
 *  "profile". Spelled locally so this control has no import back into the
 *  component that mounts it. */
const PROFILE_GLYPH = 'M8 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2 14c0-3 2.7-5 6-5s6 2 6 5'

function ProfileGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <path
        d={PROFILE_GLYPH}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Device layer read ───────────────────────────────────────────────────────
//
// The resolver answers "what is in force". It deliberately answers `null` off
// the profile-scoped route allowlist, so on `/dashboard` a persisted pick of
// `neo` resolves to unscoped — correct, but it would make this control look
// broken: you pick a profile and nothing anywhere changes.
//
// So the trigger renders the device *selection* and marks whether it is
// currently applied. This is not a second answer to "which profile" — it is the
// input, shown as an input. Nothing keys off it.
//
// `useSyncExternalStore` with an explicit server snapshot rather than
// `useSessionsFilterStore(s => s.profile)`: `persist` rehydrates from
// localStorage synchronously at module init, so zustand's own snapshot already
// holds the stored name during the hydrating render and React would paint a
// name the server never rendered.

function subscribeDeviceProfile(listener: () => void): () => void {
  return useSessionsFilterStore.subscribe(listener)
}

function getDeviceProfile(): string {
  return useSessionsFilterStore.getState().profile
}

function getServerDeviceProfile(): string {
  return UNSCOPED_PROFILE
}

function useDeviceProfileSelection(): string {
  return useSyncExternalStore(
    subscribeDeviceProfile,
    getDeviceProfile,
    getServerDeviceProfile,
  )
}

export interface NavProfileSelectorV2Props {
  collapsed?: boolean
  /**
   * Start a new session in `profile` (`null` = unscoped). Supplied by the nav,
   * which has router context. Present ⇒ a URL-pinned tab still offers the menu,
   * as a navigation. Absent ⇒ a pinned tab renders the control disabled.
   */
  onNewSessionInProfile?: (profile: string | null) => void
}

export function NavProfileSelectorV2({
  collapsed,
  onNewSessionInProfile,
}: NavProfileSelectorV2Props) {
  const scope = useProfileScope()
  const setProfile = useSessionsFilterStore((s) => s.setProfile)
  const devicePick = useDeviceProfileSelection()

  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

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
    // The menu is `position: fixed` against a trigger that lives in a scrolling
    // column, so anything that moves the trigger detaches the two. Close rather
    // than chase — a menu hanging beside nothing is worse than one that shut.
    function handleReflow() {
      setOpen(false)
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('scroll', handleReflow, true)
    window.addEventListener('resize', handleReflow)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('scroll', handleReflow, true)
      window.removeEventListener('resize', handleReflow)
    }
  }, [open])

  /** The tab's URL pins the profile; nothing selectable here can outrank it. */
  const pinned = scope.source === 'url'
  /** The device layer's raw pick, sentinel collapsed. */
  const deviceProfile = devicePick === UNSCOPED_PROFILE ? null : devicePick
  /** What the control presents as chosen. Pinned ⇒ the URL's profile. */
  const selected = pinned ? scope.profile : deviceProfile
  /** False when a pick exists but this route is outside the profile-scoped
   *  allowlist, so the resolver is (correctly) ignoring it here. */
  const applied = scope.profile === selected
  /** A pinned control can still offer a NEW session in another profile. */
  const offersNavigation = pinned && typeof onNewSessionInProfile === 'function'
  const interactive = !pinned || offersNavigation

  const label = selected ?? UNSCOPED_PROFILE

  const description = pinned
    ? `This chat is scoped to ${label} by its link — picking another profile opens a new session in it rather than moving this one.`
    : !applied
      ? `Working profile: ${label} — applies on the chat surface; this screen is unscoped.`
      : selected
        ? `Working profile: ${selected}`
        : "Working profile: the gateway's active profile (unscoped)"

  const handleSelect = useCallback(
    (name: string | null) => {
      // The enforcement point for "the URL wins": while pinned there is no code
      // path from this component to `setProfile`. The alternative — accepting
      // the pick and letting the resolver discard it — is the two-picker bug
      // that made the header and the send target disagree.
      if (pinned) {
        onNewSessionInProfile?.(name)
      } else {
        setProfile(name ?? UNSCOPED_PROFILE)
      }
      setOpen(false)
    },
    [onNewSessionInProfile, pinned, setProfile],
  )

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      if (wasOpen) return false
      // `position: fixed`, anchored off the trigger: the nav column sets
      // `overflow: hidden` and scrolls its body, so an absolutely positioned
      // menu is clipped — and at the 48px collapsed width it would be a sliver.
      const rect = triggerRef.current?.getBoundingClientRect()
      const viewport = typeof window === 'undefined' ? 0 : window.innerWidth
      setAnchor({
        top: rect ? rect.bottom + 4 : 0,
        left: rect
          ? Math.max(8, Math.min(rect.left, viewport - MENU_WIDTH - 8))
          : 8,
      })
      return true
    })
  }, [])

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        data-testid="nav-profile-selector"
        data-pinned={pinned ? 'url' : undefined}
        data-scoped={selected ? 'true' : undefined}
        data-applied={applied ? 'true' : 'false'}
        disabled={!interactive}
        aria-haspopup={interactive ? 'menu' : undefined}
        aria-expanded={interactive ? open : undefined}
        aria-label={
          pinned
            ? `Working profile: ${label}, pinned by this chat's link`
            : selected
              ? `Working profile: ${selected}`
              : 'Working profile: active profile'
        }
        title={collapsed ? `Profile — ${description}` : description}
        onClick={interactive ? toggle : undefined}
        className="m-mono"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : undefined,
          gap: collapsed ? 0 : 8,
          padding: collapsed ? '8px 0' : '6px 12px',
          borderRadius: 4,
          width: '100%',
          boxSizing: 'border-box',
          marginBottom: 2,
          background: 'none',
          border: 'none',
          color: 'var(--theme-muted)',
          fontSize: 11,
          cursor: interactive ? 'pointer' : 'default',
          position: 'relative',
        }}
      >
        <ProfileGlyph />
        {collapsed ? (
          selected && (
            // Collapsed, the name has nowhere to go — but "which profile" is
            // exactly the state you must not lose track of, so the rail keeps a
            // marker rather than hiding the control.
            <span
              aria-hidden
              data-testid="nav-profile-marker"
              style={{
                position: 'absolute',
                top: 5,
                right: 9,
                width: 5,
                height: 5,
                borderRadius: 999,
                background: applied ? ACCENT : 'var(--theme-muted)',
              }}
            />
          )
        ) : (
          <>
            <span className="m-label" style={{ opacity: 0.6 }}>
              Profile
            </span>
            <span
              data-testid="nav-profile-value"
              className="m-mono truncate"
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: 'right',
                color: selected && applied ? ACCENT : 'var(--theme-muted)',
                opacity: selected && !applied ? 0.7 : 1,
              }}
            >
              {label}
            </span>
            <span
              aria-hidden
              className="m-mono"
              style={{ fontSize: 8, opacity: 0.6 }}
            >
              {pinned ? '⚲' : '▾'}
            </span>
          </>
        )}
      </button>

      {open && interactive && (
        <NavProfileMenu
          anchor={anchor}
          pinned={pinned}
          selected={selected}
          onSelect={handleSelect}
        />
      )}
    </div>
  )
}

// ── Menu ────────────────────────────────────────────────────────────────────

interface NavProfileMenuProps {
  anchor: { top: number; left: number }
  pinned: boolean
  selected: string | null
  onSelect: (profile: string | null) => void
}

/**
 * Mounted only while open — see the module doc. Everything it reads
 * (`useAgentProfiles` → `PROFILES_LIST_KEY`, `useProfileSessionTotals`, and one
 * `useProfileScopeStatus` per row → `PROFILE_SCOPE_STATUS_KEY`) is an observer
 * on an existing shared query. No new fetcher is registered on any of those
 * keys: `use-profiles-list` documents the outage that caused — several
 * surfaces registering different `queryFn`s under `['profiles','list']`, and
 * whichever observer fetched first won the cache entry.
 */
function NavProfileMenu({
  anchor,
  pinned,
  selected,
  onSelect,
}: NavProfileMenuProps) {
  const { profiles: names } = useAgentProfiles()
  const { totals } = useProfileSessionTotals()

  const rows = useMemo(() => {
    // Union, not either source alone: the roster knows profiles with no
    // sessions yet, and the totals know profiles whose `state.db` failed to
    // report (which is precisely the row that must not be dropped).
    const byName = new Map<string, ProfileTotalRow | null>()
    for (const name of names) {
      const trimmed = name.trim()
      if (trimmed) byName.set(trimmed, byName.get(trimmed) ?? null)
    }
    for (const total of totals) byName.set(total.profile, total)
    // A selection neither source lists still renders — otherwise the only way
    // to see (or leave) it would vanish with the roster.
    if (selected && !byName.has(selected)) byName.set(selected, null)
    return [...byName.entries()]
      .map(([profile, total]) => ({ profile, total }))
      .sort((a, b) => a.profile.localeCompare(b.profile))
  }, [names, totals, selected])

  return (
    <div
      role="menu"
      aria-label={pinned ? 'Start a new session in a profile' : 'Select profile'}
      data-testid="nav-profile-menu"
      style={{
        position: 'fixed',
        top: anchor.top,
        left: anchor.left,
        zIndex: 100,
        minWidth: MENU_WIDTH,
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
      <div
        className="m-label"
        style={{ padding: '4px 8px', color: 'var(--theme-muted)', opacity: 0.7 }}
      >
        {pinned ? 'New session in' : 'Working profile'}
      </div>
      <NavProfileOption
        profile={UNSCOPED_PROFILE}
        hint="gateway profile"
        total={null}
        selected={selected === null}
        pinned={pinned}
        onSelect={() => onSelect(null)}
      />
      {rows.map((row) => (
        <NavProfileOption
          key={row.profile}
          profile={row.profile}
          total={row.total}
          selected={row.profile === selected}
          pinned={pinned}
          onSelect={() => onSelect(row.profile)}
        />
      ))}
    </div>
  )
}

interface NavProfileOptionProps {
  profile: string
  hint?: string
  total: ProfileTotalRow | null
  selected: boolean
  pinned: boolean
  onSelect: () => void
}

function NavProfileOption({
  profile,
  hint,
  total,
  selected,
  pinned,
  onSelect,
}: NavProfileOptionProps) {
  // `hint` marks the unscoped sentinel, which is not a profile name and has
  // nothing to probe: unscoped means "whatever this gateway already serves".
  const status = useProfileScopeStatus(hint ? null : profile)
  // Only a CONFIRMED "nothing serves this" disables the row. `'unknown'` means
  // the topology could not be read (remote/gated dashboard, failed probe) — it
  // must never read as served, but disabling every row on an install that
  // cannot be probed would break the control instead of protecting it.
  const unreachable = status.reachability === 'not-served'
  // A profile whose `state.db` schema drifted comes back with an error instead
  // of a count. It renders '!' — never '0'. A silent zero on a profile holding
  // real sessions is a lie in the direction of data loss.
  const degraded = total?.error != null
  const blockedReason = unreachable
    ? (status.reason ?? `This gateway does not serve "${profile}".`)
    : null
  const color = unreachable || degraded ? ERROR_COLOR : 'var(--theme-text)'

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      data-testid={`nav-profile-option-${profile}`}
      data-reachability={hint ? undefined : status.reachability}
      data-degraded={degraded || undefined}
      disabled={unreachable}
      title={
        blockedReason
          ? `${profile}: ${blockedReason}`
          : degraded
            ? `${profile}: ${total.error}`
            : pinned
              ? `Start a new session in ${profile}`
              : undefined
      }
      aria-label={
        blockedReason
          ? `${profile} profile unavailable: ${blockedReason}`
          : degraded
            ? `${profile} profile unavailable: ${total.error}`
            : total
              ? `${profile} profile, ${total.count} sessions`
              : `${profile} profile`
      }
      onClick={unreachable ? undefined : onSelect}
      className="m-mono flex items-center justify-between gap-2 rounded px-2 py-1"
      style={{
        fontSize: 10,
        textAlign: 'left',
        border: `1px solid ${selected ? ACCENT : 'transparent'}`,
        background: selected ? ACCENT_BG : 'transparent',
        color,
        opacity: unreachable ? 0.55 : 1,
        cursor: unreachable ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <span className="truncate">
        {profile}
        {hint && (
          <span style={{ color: 'var(--theme-muted)', marginLeft: 4 }}>
            {hint}
          </span>
        )}
      </span>
      {total && (
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
          {degraded ? '!' : total.count}
        </span>
      )}
    </button>
  )
}
