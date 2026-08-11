'use client'

/**
 * primary-nav-v2.tsx — 232px primary navigation column for the v2 3-column layout.
 *
 * Mockup spec:
 *  - 232px wide, dark sidebar bg, right border
 *  - Top: HERMES brand glyph + name + version
 *  - Search row (⌘K hotkey hint)
 *  - New Session row
 *  - MAIN group: Dashboard, Chat, Files, Terminal, Jobs, Tasks, Conductor, Operations
 *  - KNOWLEDGE group: Memory, Skills, MCP, Profiles
 *  - Footer: connected dot + "connected" text + cog icon
 *
 * Active state: green-tinted bg + green text + inset 2px green left border.
 * Hover: subtle fill.
 * Mono font, uppercase group labels with letter-spacing.
 *
 * Non-existent routes are rendered as non-link buttons.
 */

import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { NavProfileSelectorV2 } from './nav-profile-selector-v2'
import { useResolvedProfile } from '@/hooks/use-resolved-profile'
import { useSearchModal } from '@/hooks/use-search-modal'
import { getTheme, getThemeVariant, isDarkTheme, setTheme } from '@/lib/theme'
import { SettingsDialog } from '@/components/settings-dialog'
import { useBoards } from '@/lib/boards-api'
import { useProjects } from '@/lib/projects-api'
import { useNavCounts } from '@/hooks/use-nav-counts'
import { useSelfImproveAvailable } from '@/hooks/use-self-improve-available'
import { useSetupWizardStore } from '@/stores/setup-wizard-store'
import { useOnboardingChecklist } from '@/screens/onboarding/hooks/use-onboarding-checklist'

// ── Icons (inline SVG) ────────────────────────────────────────────────────────

function Icon({ d, size = 15 }: { d: string; size?: number }) {
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
        d={d}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Icon paths
const ICONS = {
  dashboard: 'M2 2h5v5H2V2zM9 2h5v5H9V2zM2 9h5v5H2V9zM9 9h5v5H9V9z',
  chat: 'M2 3h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V4a1 1 0 0 1 1-1z',
  files: 'M3 2h6l4 4v9H3V2zM9 2v4h4',
  terminal: 'M2 3h12v10H2V3zM5 7l3-2-3-2M8 11h4',
  jobs: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v3.5l2.5 1.5',
  tasks: 'M3 4h10M3 8h7M3 12h5',
  workflows: 'M2 4h12M2 8h8M2 12h5M11 9l2 2 4-4',
  commands: 'M3 3h10v10H3V3zM5 6l2 2-2 2M8.5 10h2.5',
  boards: 'M3 3h4v4H3V3zM9 3h4v4H9V3zM3 9h4v4H3V9zM9 9h4v4H9V9z',
  templates: 'M4 3h6l2 2v6H4V3zM6 6h4M6 8h3M2 5v8h7',
  projects:
    'M2 4a2 2 0 0 1 2-2h3l1.5 2H12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z',
  conductor: 'M8 2L2 14h12L8 2zM8 8v3',
  operations:
    'M3 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM9 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM1 14c0-2.5 2-4 5-4s5 1.5 5 4M11 11c1.5 0 3 .8 3 3',
  matrix3d: 'M8 2l5 3v6l-5 3-5-3V5l5-3zM8 2v12M3 5l5 3 5-3M3 11l5-3 5 3',
  selfImprove: 'M2 12l4-4 3 3 5-7M13 4h1v4',

  memory:
    'M5 3h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM6 7h4M6 9h2',
  skills: 'M8 2l1.8 3.8 4.2.6-3 3 .7 4.1L8 11.5l-3.7 2L5 9.4l-3-3 4.2-.6z',
  mcp: 'M4 8h8M8 4v8M3 3l10 10M13 3L3 13',
  profiles: 'M8 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2 14c0-3 2.7-5 6-5s6 2 6 5',
  search: 'M6.5 1.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM10.5 10.5l4 4',
  newchat: 'M3 8h10M8 3v10',
  cog: 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4',
  docs: 'M3 2h7l3 3v9H3V2zM10 2v3h3M5 8h6M5 11h4',
  providers:
    'M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7l5.5-3zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  setup:
    'M2 14l7-7M9.5 2.5l1 1.5 1.5 1-1.5 1-1 1.5-1-1.5-1.5-1 1.5-1 1-1.5zM13 8l.6 1.1 1.1.6-1.1.6-.6 1.1-.6-1.1-1.1-.6 1.1-.6.6-1.1z',
  backups: 'M3 3h18v4H3V3zm0 6h18v12H3V9zm4 3h10v2H7v-2z',
} as const

// ── Styles ────────────────────────────────────────────────────────────────────

const NAV_WIDTH = 232
const NAV_COLLAPSED_WIDTH = 48
const selectPathname = (s: { location: { pathname: string } }) =>
  s.location.pathname

function getItemStyle(active: boolean): React.CSSProperties {
  if (active) {
    return {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 10px',
      borderRadius: 4,
      background:
        'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 10%, transparent)',
      color: 'var(--m-green-400, var(--theme-accent))',
      borderLeft: '2px solid var(--m-green-500, var(--theme-accent))',
      boxShadow:
        'inset 2px 0 6px color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 20%, transparent)',
      fontSize: 11,
      fontWeight: 500,
      cursor: 'pointer',
      textDecoration: 'none',
      width: '100%',
      boxSizing: 'border-box',
    }
  }
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    borderRadius: 4,
    color: 'var(--theme-muted)',
    fontSize: 11,
    fontWeight: 400,
    cursor: 'pointer',
    textDecoration: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'background 0.1s, color 0.1s',
  }
}

// ── Nav item component ────────────────────────────────────────────────────────

interface NavItemProps {
  label: string
  iconKey: keyof typeof ICONS
  to?: string
  /** Action item — rendered as a real button instead of a link. */
  onClick?: () => void
  active: boolean
  collapsed?: boolean
  badge?: string | number | null
  compact?: boolean
}

function NavItem({
  label,
  iconKey,
  to,
  onClick,
  active,
  collapsed,
  badge,
  compact,
}: NavItemProps) {
  const baseStyle = getItemStyle(active)
  const style = collapsed
    ? { ...baseStyle, justifyContent: 'center', padding: '8px 0' }
    : compact
      ? { ...baseStyle, padding: '5px 12px 5px 28px' }
      : baseStyle

  const content = (
    <>
      <Icon d={ICONS[iconKey]} />
      {!collapsed && <span style={{ flex: 1, minWidth: 0 }}>{label}</span>}
      {!collapsed && badge !== undefined && badge !== null && (
        <span
          className="m-mono"
          style={{
            fontSize: 9,
            lineHeight: 1,
            padding: '2px 5px',
            borderRadius: 999,
            border: '1px solid var(--theme-border)',
            color: active
              ? 'var(--m-green-400, var(--theme-accent))'
              : 'var(--theme-muted)',
          }}
        >
          {badge}
        </span>
      )}
    </>
  )

  if (to) {
    return (
      <Link
        to={to}
        style={style}
        className="m-mono primary-nav-v2-item"
        data-active={active ? 'true' : undefined}
        title={collapsed ? label : undefined}
      >
        {content}
      </Link>
    )
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          ...style,
          background: active ? style.background : 'none',
          border: 'none',
          borderLeft: active ? style.borderLeft : undefined,
          textAlign: 'left',
        }}
        className="m-mono primary-nav-v2-item"
        data-active={active ? 'true' : undefined}
        title={collapsed ? label : undefined}
      >
        {content}
      </button>
    )
  }

  return (
    <button
      type="button"
      style={{ ...style, background: undefined }}
      className="m-mono primary-nav-v2-item"
      aria-disabled="true"
      title={collapsed ? label : undefined}
    >
      {content}
    </button>
  )
}

// ── Group label ───────────────────────────────────────────────────────────────

function GroupLabel({ label }: { label: string }) {
  return (
    <div
      className="m-label"
      style={{
        padding: '10px 12px 4px',
        color: 'var(--theme-muted)',
        opacity: 0.6,
        userSelect: 'none',
      }}
    >
      {label}
    </div>
  )
}

// ── Connected footer dot ──────────────────────────────────────────────────────

function ConnectedFooter({ collapsed }: { collapsed?: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isDark, setIsDark] = useState(() => isDarkTheme(getTheme()))
  const handleToggleTheme = useCallback(() => {
    const current = getTheme()
    const dark = isDarkTheme(current)
    setTheme(getThemeVariant(current, dark ? 'light' : 'dark'))
    setIsDark(!dark)
  }, [])
  return (
    <>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: 8,
          padding: collapsed ? '8px 0' : '8px 12px',
          borderTop: '1px solid var(--theme-border)',
          marginTop: 'auto',
        }}
      >
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          className="m-mono"
          style={{
            background: 'none',
            border: 'none',
            padding: 6,
            borderRadius: 4,
            color: 'var(--theme-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
          }}
        >
          <Icon d={ICONS.cog} size={14} />
          {!collapsed && <span>Settings</span>}
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={handleToggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Light mode' : 'Dark mode'}
            style={{
              background: 'none',
              border: 'none',
              padding: 6,
              borderRadius: 4,
              color: 'var(--theme-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {isDark ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden
              >
                <circle
                  cx="8"
                  cy="8"
                  r="3"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden
              >
                <path
                  d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        )}
      </div>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const NAV_COLLAPSED_KEY = 'hermes.primary-nav.collapsed'

function readInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(NAV_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

function useAgentVersion(): string | null {
  const { data } = useQuery({
    queryKey: ['agent-version'],
    queryFn: async () => {
      const res = await fetch('/api/agent-version', {
        credentials: 'same-origin',
      })
      if (!res.ok) return { version: null }
      return (await res.json()) as { version: string | null }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  return data?.version ?? null
}

/**
 * The `search` a `/chat/$sessionKey` navigation should carry for `profile`.
 *
 * Scoped ⇒ spell the resolved profile explicitly, so the new session is pinned
 * to the profile it was created in and a later device-level switch cannot
 * retarget it mid-thread.
 *
 * Unscoped ⇒ `undefined`, i.e. "unspecified", which is NOT the same as
 * `{ profile: undefined }` (an explicit clear). Unspecified lets the route's
 * `retainSearchParams(['profile'])` middleware decide, which on an unscoped
 * install produces the byte-identical empty search string it produces today.
 *
 * Exported because it is the whole of the rule; the JSX below is one line.
 */
export function newSessionSearch(
  profile: string | null,
): { profile: string } | undefined {
  return profile ? { profile } : undefined
}

export function PrimaryNavV2() {
  const pathname = useRouterState({ select: selectPathname })
  const navigate = useNavigate()
  // The resolved profile (`url ?? device ?? null`) — the same answer the
  // composer sends to, so a session started from this nav lands where the
  // selector above it says it will.
  const resolvedProfile = useResolvedProfile()
  /** A URL-pinned tab cannot be re-scoped, so the selector offers this instead
   *  of a write the resolver would discard: a NEW session in the picked
   *  profile, leaving the open one in the profile it belongs to. */
  const openNewSessionInProfile = useCallback(
    (profile: string | null) => {
      navigate({
        to: '/chat/$sessionKey',
        params: { sessionKey: 'new' },
        // Explicit `undefined` here, not an omitted key: `retainSearchParams`
        // reads an omitted key as "unspecified" and fills the pin back in, so
        // omitting it would make "start a new unscoped session" impossible.
        search: { profile: profile ?? undefined },
      })
    },
    [navigate],
  )
  const selfImproveAvailable = useSelfImproveAvailable()
  const openSearchModal = useSearchModal((s) => s.openModal)
  const openSetupWizard = useSetupWizardStore((s) => s.openSetupWizard)
  const { outstanding: setupOutstanding, ready: setupReady } =
    useOnboardingChecklist()
  const agentVersion = useAgentVersion()
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed)
  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      try {
        window.localStorage.setItem(NAV_COLLAPSED_KEY, String(next))
      } catch {
        /* noop */
      }
      return next
    })
  }, [])

  // Active states
  const isDashboard = pathname === '/dashboard'
  const isChat =
    pathname === '/' || pathname === '/new' || pathname.startsWith('/chat')
  const isFiles = pathname.startsWith('/files')
  const isTerminal = pathname.startsWith('/terminal')
  const isJobs = pathname.startsWith('/jobs')
  const isTasks = pathname.startsWith('/tasks')
  const isWorkflows = pathname.startsWith('/workflows')
  const isCommands = pathname.startsWith('/commands')
  const isBoards = pathname.startsWith('/boards')
  const isTemplates = pathname.startsWith('/board-templates')
  const isProjects = pathname.startsWith('/projects')
  const isConductor = pathname.startsWith('/conductor')
  // const isOperations = pathname.startsWith('/operations')
  const isMatrix3D = pathname.startsWith('/matrix3d')
  const isSelfImprove = pathname.startsWith('/self-improve')

  const isMemory = pathname.startsWith('/memory')
  const isSkills = pathname.startsWith('/skills')
  const isPlugins = pathname.startsWith('/plugins')
  const isMcp = pathname.startsWith('/mcp')
  const isProfiles = pathname.startsWith('/profiles')
  const isProviders = pathname.startsWith('/settings/providers')
  const isSettings = pathname.startsWith('/settings') && !isProviders
  const isBackups = pathname === '/backups' || pathname.startsWith('/backups')
  const isDocs = pathname.startsWith('/docs')
  const boardsQuery = useBoards(true, !collapsed)
  const boardsCount = boardsQuery.data?.boards.length
  const projectsQuery = useProjects(false, !collapsed)
  const projectsCount = projectsQuery.data?.projects.length
  const counts = useNavCounts(!collapsed)
  const boardChildren = useMemo(
    () => [
      {
        label: 'Board',
        to: '/tasks',
        active: isTasks,
        iconKey: 'tasks' as const,
      },
      {
        label: 'Boards',
        to: '/boards',
        active: isBoards,
        iconKey: 'boards' as const,
        badge: boardsCount,
      },
      {
        label: 'Templates',
        to: '/board-templates',
        active: isTemplates,
        iconKey: 'templates' as const,
        badge: counts.templates,
      },
      {
        label: 'Projects',
        to: '/projects',
        active: isProjects,
        iconKey: 'projects' as const,
        badge: projectsCount,
      },
    ],
    [
      boardsCount,
      counts.templates,
      isBoards,
      isProjects,
      isTasks,
      isTemplates,
      projectsCount,
    ],
  )
  const boardsSectionActive = isTasks || isBoards || isTemplates || isProjects

  const w = collapsed ? NAV_COLLAPSED_WIDTH : NAV_WIDTH

  return (
    <div
      data-testid="primary-nav-v2"
      data-collapsed={collapsed ? 'true' : undefined}
      className="rounded-md my-2 mx-2"
      style={{
        width: w,
        minWidth: w,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--theme-sidebar)',
        border: '1px solid var(--theme-border)',
        overflow: 'hidden',
        transition: 'width 160ms ease-out',
      }}
    >
      {/* Brand header */}
      <div
        style={{
          display: 'flex',
          flexDirection: collapsed ? 'column' : 'row',
          alignItems: 'center',
          gap: collapsed ? 4 : 8,
          padding: collapsed ? '8px 0' : '10px 12px 8px',
          justifyContent: collapsed ? 'center' : 'space-between',
          borderBottom: '1px solid var(--theme-border)',
          flexShrink: 0,
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
        >
          <img
            src="/claude-avatar.webp"
            alt="Hermes"
            style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0 }}
          />
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div
                className="m-mono"
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  color: 'var(--theme-text)',
                  lineHeight: 1.2,
                }}
              >
                HERMES{agentVersion ? ` (${agentVersion})` : ''}
              </div>
              <div
                className="m-label"
                style={{
                  color: 'var(--theme-muted)',
                  opacity: 0.7,
                }}
              >
                Switchui ({__APP_VERSION__})
              </div>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Collapse navigation"
            title="Collapse"
            style={{
              background: 'none',
              border: 'none',
              padding: 4,
              borderRadius: 4,
              color: 'var(--theme-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden
            >
              <path
                d={'M10 3L5 8l5 5'}
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Scrollable nav body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          padding: '6px 6px 0',
        }}
      >
        {/* Search */}
        {!collapsed && (
          <button
            type="button"
            onClick={openSearchModal}
            className="m-mono"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderRadius: 4,
              width: '100%',
              background: 'none',
              border: 'none',
              color: 'var(--theme-muted)',
              fontSize: 11,
              cursor: 'pointer',
              boxSizing: 'border-box',
              marginBottom: 2,
            }}
            aria-label="Search (⌘K)"
          >
            <Icon d={ICONS.search} />
            <span style={{ flex: 1, textAlign: 'left' }}>Search</span>
            <span className="m-mono" style={{ fontSize: 9, opacity: 0.5 }}>
              ⌘K
            </span>
          </button>
        )}

        {/* Working profile — ABOVE New Session, not instead of it: setting a
            scope and starting a session are different verbs, and the second is
            the nav's highest-frequency action. Rendered in the collapsed rail
            too; "which profile" is the last state to hide. */}
        <NavProfileSelectorV2
          collapsed={collapsed}
          onNewSessionInProfile={openNewSessionInProfile}
        />

        {/* New Session — hidden when collapsed; chevron expand takes its slot */}
        {collapsed ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Expand navigation"
            title="Expand"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '6px 0',
              borderRadius: 4,
              color: 'var(--theme-muted)',
              cursor: 'pointer',
              width: '100%',
              boxSizing: 'border-box',
              marginBottom: 4,
              background: 'none',
              border: 'none',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden
            >
              <path
                d="M6 3l5 5-5 5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <Link
            to="/chat/$sessionKey"
            params={{ sessionKey: 'new' }}
            // Carries the profile the selector above says you are working in.
            // Without it the new chat inherits whatever `?profile=` happened to
            // be sticky on the current URL — which is right on the chat surface
            // and wrong everywhere else.
            search={newSessionSearch(resolvedProfile)}
            className="m-mono"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderRadius: 4,
              color: 'var(--m-green-400, var(--theme-accent))',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'none',
              width: '100%',
              boxSizing: 'border-box',
              marginBottom: 4,
              opacity: 0.9,
            }}
            aria-label="New Session"
          >
            <Icon d={ICONS.newchat} />+ New Session
          </Link>
        )}

        {/* MAIN group */}
        {!collapsed && <GroupLabel label="Main" />}
        <NavItem
          label="Dashboard"
          iconKey="dashboard"
          to="/dashboard"
          active={isDashboard}
          collapsed={collapsed}
        />
        <NavItem
          label="Chat"
          iconKey="chat"
          to="/chat"
          active={isChat}
          collapsed={collapsed}
          badge={counts.chat}
        />
        <NavItem
          label="Files"
          iconKey="files"
          to="/files"
          active={isFiles}
          collapsed={collapsed}
        />
        <NavItem
          label="Terminal"
          iconKey="terminal"
          to="/terminal"
          active={isTerminal}
          collapsed={collapsed}
        />
        <NavItem
          label="Jobs"
          iconKey="jobs"
          to="/jobs"
          active={isJobs}
          collapsed={collapsed}
          badge={counts.jobs}
        />
        <NavItem
          label="Tasks"
          iconKey="tasks"
          to="/tasks"
          active={boardsSectionActive}
          collapsed={collapsed}
          badge={counts.tasks}
        />
        {!collapsed && (
          <div
            style={{ display: 'grid', gap: 4, marginTop: -2, marginBottom: 2 }}
          >
            {boardChildren.map((item) => (
              <NavItem
                key={item.label}
                label={item.label}
                iconKey={item.iconKey}
                to={item.to}
                active={item.active}
                collapsed={collapsed}
                badge={item.badge}
                compact
              />
            ))}
          </div>
        )}
        <NavItem
          label="Workflows"
          iconKey="workflows"
          to="/workflows"
          active={isWorkflows}
          collapsed={collapsed}
          badge={counts.workflows}
        />
        <NavItem
          label="Commands"
          iconKey="commands"
          to="/commands"
          active={isCommands}
          collapsed={collapsed}
          badge={counts.commands}
        />
        <NavItem
          label="Conductor"
          iconKey="conductor"
          to="/conductor"
          active={isConductor}
          collapsed={collapsed}
        />
        {/* <NavItem label="Operations" iconKey="operations" to="/operations" active={isOperations} collapsed={collapsed} /> */}
        <NavItem
          label="Matrix3D"
          iconKey="matrix3d"
          to="/matrix3d"
          active={isMatrix3D}
          collapsed={collapsed}
        />
        {selfImproveAvailable === true && (
          <NavItem
            label="Self-Improve"
            iconKey="selfImprove"
            to="/self-improve"
            active={isSelfImprove}
            collapsed={collapsed}
          />
        )}

        {/* KNOWLEDGE group */}
        {!collapsed && <GroupLabel label="Knowledge" />}
        <NavItem
          label="Memory"
          iconKey="memory"
          to="/memory"
          active={isMemory}
          collapsed={collapsed}
        />

        {/* SETTINGS group */}
        {!collapsed && <GroupLabel label="Settings" />}
        <NavItem
          label="Settings"
          iconKey="cog"
          to="/settings"
          active={isSettings}
          collapsed={collapsed}
        />
        <NavItem
          label="Providers"
          iconKey="providers"
          to="/settings/providers"
          active={isProviders}
          collapsed={collapsed}
        />
        <NavItem
          label="Skills"
          iconKey="skills"
          to="/skills"
          active={isSkills}
          collapsed={collapsed}
          badge={counts.skills}
        />
        <NavItem
          label="Plugins"
          iconKey="skills"
          to="/plugins"
          active={isPlugins}
          collapsed={collapsed}
          badge={counts.plugins}
        />
        <NavItem
          label="MCP"
          iconKey="mcp"
          to="/mcp"
          active={isMcp}
          collapsed={collapsed}
          badge={counts.mcp}
        />
        <NavItem
          label="Profiles"
          iconKey="profiles"
          to="/profiles"
          active={isProfiles}
          collapsed={collapsed}
          badge={counts.profiles}
        />
        <NavItem
          label="Backups"
          iconKey="backups"
          to="/backups"
          active={isBackups}
          collapsed={collapsed}
        />

        {/* HELP group */}
        {!collapsed && <GroupLabel label="Help" />}
        <NavItem
          label="Setup Wizard"
          iconKey="setup"
          // Wrapped, not passed by reference: React hands an onClick its event
          // as the first argument, which `openSetupWizard(at?)` would read as
          // a deep-link target.
          onClick={() => openSetupWizard()}
          active={false}
          collapsed={collapsed}
          badge={
            setupReady && setupOutstanding > 0 ? setupOutstanding : undefined
          }
        />
        <NavItem
          label="Docs"
          iconKey="docs"
          to="/docs"
          active={isDocs}
          collapsed={collapsed}
        />
      </div>

      {/* Footer */}
      <ConnectedFooter collapsed={collapsed} />
    </div>
  )
}
